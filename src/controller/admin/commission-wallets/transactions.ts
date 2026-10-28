import { Prisma, RoleSpecial } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import moment from "moment";
import userMiddleware from "@root/src/middleware/user";
import { prismaClient } from "@src/utils/prisma";
import reportUtils from "@src/utils/report";

const querySchema = z.object({
  customerId: z.coerce.number().int().positive().max(2147483647),
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const exportQuerySchema = querySchema.pick({ customerId: true });

type TransactionRow = {
  id: bigint;
  type: string;
  direction: string;
  amount: bigint;
  balanceAfter: bigint;
  calculationDate: string;
  createdAt: bigint;
  metadata: unknown;
};

const titles: Record<string, string> = {
  direct: "Nhận hoa hồng trực tiếp",
  small_branch: "Nhận thưởng doanh số nhóm nhỏ",
  accumulation: "Nhận tích sản",
  income_contribution: "Trích thu nhập đóng quỹ tích sản",
  positive_contribution: "Trích thu nhập tích lũy tái mua",
  positive_upline_reward: "Nhận thưởng tích cực tuyến dưới",
  resonance: "Nhận thưởng cộng hưởng",
  agency_revenue: "Nhận thưởng doanh số đại lý",
  agency_same_tier: "Nhận thưởng đồng cấp đại lý",
  withdrawal: "Rút tiền hoa hồng",
  order_payment: "Thanh toán đơn hàng bằng ví hoa hồng",
};

function money(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new Error("Giá trị giao dịch vượt giới hạn số nguyên an toàn");
  }
  return amount;
}

function content(row: TransactionRow): string {
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  if (row.type === "manual_adjustment") {
    const title =
      row.direction === "credit"
        ? "Cộng hoa hồng thủ công"
        : "Trừ hoa hồng thủ công";
    const reason =
      typeof metadata.reason === "string" ? metadata.reason.trim() : "";
    return reason ? `${title}: ${reason}` : title;
  }
  if (row.type === "withdrawal") {
    if (row.direction === "credit") return "Hoàn tiền rút hoa hồng bị từ chối";
    if (typeof metadata.content === "string" && metadata.content.trim()) {
      return metadata.content.trim();
    }
  }
  if (row.type === "order_payment" && typeof metadata.content === "string") {
    return metadata.content;
  }
  return titles[row.type] || "Giao dịch hoa hồng";
}

function transactionRows(customerId: number, skip?: number, limit?: number) {
  const pagination =
    skip === undefined || limit === undefined
      ? Prisma.empty
      : Prisma.sql`OFFSET ${skip} LIMIT ${limit}`;
  return prismaClient.$queryRaw<TransactionRow[]>(Prisma.sql`
    WITH ledger AS (
      SELECT "id", "type", "direction", "amount",
        "calculationDate", "createdAt", "metadata",
        SUM(CASE WHEN "direction" = 'credit' THEN "amount"
          ELSE -"amount" END) OVER (
            ORDER BY "createdAt" ASC NULLS FIRST, "id" ASC
        )::bigint AS "balanceAfter"
      FROM "commissionTransaction"
      WHERE "customerId" = ${customerId}
    )
    SELECT "id", "type", "direction", "amount", "balanceAfter",
      "calculationDate", "createdAt", "metadata"
    FROM ledger
    WHERE "amount" > 0
    ORDER BY "createdAt" DESC NULLS LAST, "id" DESC
    ${pagination}
  `);
}

function hasAdminAccess(req: any): boolean {
  return (
    req.roleSpecial === RoleSpecial.ROOT ||
    req.roleSpecial === RoleSpecial.ADMIN
  );
}

function excelText(value: string): string {
  return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/transactions",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Lịch sử giao dịch ví hoa hồng của khách hàng",
      querystring: querySchema,
      response: {},
    },
    handler: async (req: any, res) => {
      if (!hasAdminAccess(req)) {
        return res
          .code(403)
          .send({ code: 1, message: "Không có quyền truy cập" });
      }

      const { customerId, skip, limit } = req.query;
      try {
        const customer = await prismaClient.customer.findUnique({
          where: { id: customerId },
          select: { id: true },
        });
        if (!customer) {
          return res
            .code(404)
            .send({ code: 1, message: "Khách hàng không tồn tại" });
        }

        const [rows, counts] = await Promise.all([
          transactionRows(customerId, skip, limit),
          prismaClient.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
            SELECT COUNT(*)::bigint AS "count"
            FROM "commissionTransaction"
            WHERE "customerId" = ${customerId} AND "amount" > 0
          `),
        ]);

        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            customerId,
            total: money(counts[0]?.count ?? BigInt(0)),
            items: rows.map((row) => ({
              id: String(row.id),
              type: row.type,
              direction: row.direction,
              content: content(row),
              amount: money(row.amount),
              balanceAfter: money(row.balanceAfter),
              calculationDate: row.calculationDate,
              createdAt: money(row.createdAt),
            })),
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể tải lịch sử giao dịch hoa hồng lúc này",
        });
      }
    },
  });

  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/transactions/export",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary:
        "Admin - Xuất Excel toàn bộ lịch sử giao dịch ví hoa hồng của khách hàng",
      querystring: exportQuerySchema,
      response: {},
    },
    handler: async (req: any, res) => {
      if (!hasAdminAccess(req)) {
        return res
          .code(403)
          .send({ code: 1, message: "Không có quyền truy cập" });
      }

      const { customerId } = req.query;
      try {
        const customer = await prismaClient.customer.findUnique({
          where: { id: customerId },
          select: { id: true, name: true, email: true, phone: true },
        });
        if (!customer) {
          return res
            .code(404)
            .send({ code: 1, message: "Khách hàng không tồn tại" });
        }

        const rows = await transactionRows(customerId);
        const report = await reportUtils.reportPageBasic({
          header: {
            sequence: "STT",
            customerName: "Tên khách hàng",
            customerEmail: "Email",
            customerPhone: "Số điện thoại",
            transactionId: "Mã giao dịch",
            createdAt: "Thời gian",
            content: "Nội dung",
            amount: "Số tiền (+/-) (đ)",
            balanceAfter: "Số dư sau giao dịch (đ)",
          },
          data: rows.map((row, index) => ({
            sequence: index + 1,
            customerName: excelText(customer.name || ""),
            customerEmail: excelText(customer.email || ""),
            customerPhone: excelText(customer.phone || ""),
            transactionId: String(row.id),
            createdAt: moment
              .utc(money(row.createdAt))
              .utcOffset(7)
              .format("DD/MM/YYYY HH:mm"),
            content: excelText(content(row)),
            amount:
              row.direction === "credit"
                ? money(row.amount)
                : -money(row.amount),
            balanceAfter: money(row.balanceAfter),
          })),
        });

        res.header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.header(
          "Content-Disposition",
          `attachment; filename="lich-su-hoa-hong-${customerId}.xlsx"`,
        );
        return res.send(report);
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể xuất lịch sử giao dịch hoa hồng lúc này",
        });
      }
    },
  });
};
