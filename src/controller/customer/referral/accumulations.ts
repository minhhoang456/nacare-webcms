import { Prisma } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@src/utils/prisma";

const querySchema = z
  .object({
    skip: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    type: z
      .enum([
        "limit_increase",
        "limit_decrease",
        "accumulation_received",
        "received_adjustment",
      ])
      .optional(),
    fromDate: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    toDate: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .refine(
    ({ fromDate, toDate }) =>
      fromDate === undefined || toDate === undefined || fromDate <= toDate,
    { message: "fromDate phải nhỏ hơn hoặc bằng toDate", path: ["fromDate"] },
  );

type HistoryRow = {
  id: string;
  sortId: bigint;
  type:
    | "limit_increase"
    | "limit_decrease"
    | "accumulation_received"
    | "received_adjustment";
  amount: bigint;
  orderId: bigint | null;
  createdAt: bigint | null;
  calculationDate: string | null;
  reason: string | null;
  groupName: string | null;
};

const GROUP_NAMES: Record<string, string> = {
  under_50m: "đơn dưới 50 triệu",
  under_or_equal_10m: "đơn đến 10 triệu",
  over_10m_under_50m: "đơn trên 10 đến dưới 50 triệu",
  from_50m: "đơn từ 50 triệu",
};

function money(value: bigint | number | null | undefined): number {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result))
    throw new Error("accumulation amount is not a safe integer");
  return result;
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/accumulations",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Customer - Hạn mức và lịch sử tiêu dùng tích sản",
      description:
        "Mục 2: tổng hạn mức được tích và tiền đã nhận không phụ thuộc bộ lọc. Tiền đã nhận vẫn thuộc ví hoa hồng có thể rút.",
      querystring: querySchema,
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = Number(req.customerId);
      if (!Number.isSafeInteger(customerId) || customerId <= 0) {
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      }
      const { skip, limit, type, fromDate, toDate } = req.query;
      const filters: Prisma.Sql[] = [Prisma.sql`"amount" <> 0`];
      if (type) filters.push(Prisma.sql`"type" = ${type}`);
      if (fromDate !== undefined)
        filters.push(Prisma.sql`"createdAt" >= ${BigInt(fromDate)}`);
      if (toDate !== undefined)
        filters.push(Prisma.sql`"createdAt" <= ${BigInt(toDate)}`);
      const filter = Prisma.join(filters, " AND ");

      // Mục 2 - hạn mức phát sinh tại thời điểm đơn hoàn tất, còn khoản phân
      // phối phát sinh khi cron ghi sổ. Lịch sử vẫn giữ hai loại sự kiện;
      // tổng cộng dồn được đọc từ ví tích sản đã đồng bộ cùng transaction.
      // UNION ALL giữ riêng các sự kiện dù ID của hai bảng trùng nhau.
      const history = Prisma.sql`
        SELECT id::text AS id, id AS "sortId",
          'limit_increase'::text AS type, "maximumAmount" AS amount,
          "orderId", "sourceCreatedAt" AS "createdAt", NULL::text AS "calculationDate",
          NULL::text AS reason, "groupName"
        FROM "accumulationEntitlement" WHERE "customerId" = ${customerId}
        UNION ALL
        SELECT id::text AS id, id AS "sortId",
          'accumulation_received'::text AS type, amount,
          "sourceOrderId" AS "orderId", "createdAt", "calculationDate",
          NULL::text AS reason, NULL::text AS "groupName"
        FROM "commissionTransaction"
        WHERE "customerId" = ${customerId} AND type = 'accumulation' AND direction = 'credit'
        UNION ALL
        SELECT id::text AS id, id AS "sortId",
          'accumulation_received'::text AS type, amount,
          NULL::bigint AS "orderId", "createdAt", NULL::text AS "calculationDate",
          "metadata"->>'reason' AS reason, NULL::text AS "groupName"
        FROM "commissionTransaction"
        WHERE "customerId" = ${customerId} AND type = 'manual_adjustment'
          AND direction = 'credit' AND "metadata"->>'walletType' = 'accumulation'
        UNION ALL
        SELECT id::text AS id, 0::bigint AS "sortId",
          CASE WHEN "maximumAmount" < 0 THEN 'limit_decrease'
            ELSE 'limit_increase' END::text AS type, "maximumAmount" AS amount,
          NULL::bigint AS "orderId", "createdAt", NULL::text AS "calculationDate",
          reason, "groupName"
        FROM "accumulationManualEntitlement"
        WHERE "customerId" = ${customerId}
        UNION ALL
        SELECT id::text AS id, 0::bigint AS "sortId",
          'received_adjustment'::text AS type, amount,
          NULL::bigint AS "orderId", "createdAt", NULL::text AS "calculationDate",
          NULL::text AS reason, NULL::text AS "groupName"
        FROM "accumulationReceivedAdjustment"
        WHERE "customerId" = ${customerId}
      `;
      try {
        // Đọc cùng một snapshot để tổng và lịch sử không lệch nhau khi cron
        // đang quyết toán. Hai số tổng không lọc theo ngày/loại/phân trang.
        const [items, counts, totals] = await prismaClient.$transaction(
          [
            prismaClient.$queryRaw<HistoryRow[]>(Prisma.sql`
            SELECT * FROM (${history}) AS history WHERE ${filter}
            ORDER BY "createdAt" DESC NULLS LAST, type ASC, "sortId" DESC, id DESC
            OFFSET ${skip} LIMIT ${limit}
          `),
            prismaClient.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
            SELECT COUNT(*)::bigint AS total FROM (${history}) AS history WHERE ${filter}
          `),
            prismaClient.$queryRaw<
              Array<{
                totalEntitlementAmount: bigint;
                totalAccumulatedAmount: bigint;
              }>
            >(Prisma.sql`
            SELECT "entitlementAmount"::bigint AS "totalEntitlementAmount",
              "receivedAmount"::bigint AS "totalAccumulatedAmount"
            FROM "commissionWallet"
            WHERE "customerId" = ${customerId} AND "walletType" = 'accumulation'
          `),
          ],
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        );

        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            totalEntitlementAmount: money(totals[0]?.totalEntitlementAmount),
            totalAccumulatedAmount: money(totals[0]?.totalAccumulatedAmount),
            items: items.map((item) => ({
              createdAt: money(item.createdAt),
              type: item.type,
              typeName:
                item.type === "limit_increase"
                  ? "Tăng hạn mức"
                  : item.type === "limit_decrease"
                    ? "Giảm hạn mức"
                    : item.type === "received_adjustment"
                      ? "Điều chỉnh đã nhận"
                      : "Nhận tích sản",
              content:
                item.type === "limit_decrease"
                  ? `Trừ hạn mức tích sản thủ công${item.reason ? `: ${item.reason}` : ""}`
                  : item.type === "limit_increase"
                    ? item.orderId
                      ? `Tăng hạn mức tích sản từ đơn hàng #${String(item.orderId)}`
                      : `Cấp hạn mức tích sản thủ công${item.groupName ? ` (${GROUP_NAMES[item.groupName] || item.groupName})` : ""}${item.reason ? `: ${item.reason}` : ""}`
                    : item.type === "received_adjustment"
                      ? `${item.amount > 0 ? "Cộng" : "Trừ"} số tích sản đã nhận do admin điều chỉnh`
                      : item.reason
                        ? `Cộng tích sản thủ công: ${item.reason}`
                        : `Nhận tích sản ngày ${item.calculationDate}`,
              amount: money(item.amount),
            })),
            total: money(counts[0]?.total),
            skip,
            limit,
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res
          .code(500)
          .send({ code: 1, message: "Không thể lấy lịch sử tích sản lúc này" });
      }
    },
  });
};
