import { Prisma } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@src/utils/prisma";
import { getConsumptionPointBalance } from "@src/services/consumptionPoint.service";

const querySchema = z
  .object({
    skip: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    transactionType: z.enum(["increase", "decrease"]).optional(),
    fromDate: z.coerce.number().int().nonnegative().optional(),
    toDate: z.coerce.number().int().nonnegative().optional(),
  })
  .refine(
    ({ fromDate, toDate }) =>
      fromDate === undefined || toDate === undefined || fromDate <= toDate,
    { message: "fromDate phải nhỏ hơn hoặc bằng toDate", path: ["fromDate"] },
  );

type PointHistoryRow = {
  type: string;
  direction: string;
  amount: bigint;
  balance: bigint;
  sourceOrderId: bigint | null;
  createdAt: bigint;
};

function point(value: bigint | number | null | undefined): number {
  const result = Number(value || 0);
  if (!Number.isSafeInteger(result)) {
    throw new Error(
      `consumption point is not a safe integer: ${String(value)}`,
    );
  }
  return result;
}

function typeName(type: string): string {
  if (type === "direct_reward") return "Thưởng điểm tiêu dùng";
  if (type === "order_payment") return "Sử dụng điểm tiêu dùng";
  return "Điểm tiêu dùng";
}

function content(row: PointHistoryRow): string {
  if (row.type === "direct_reward" && row.sourceOrderId) {
    return `Nhận điểm tiêu dùng từ đơn hàng #${String(row.sourceOrderId)}`;
  }
  if (row.type === "order_payment" && row.sourceOrderId) {
    return `Dùng điểm tiêu dùng thanh toán đơn hàng #${String(row.sourceOrderId)}`;
  }
  return typeName(row.type);
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/consumption-points",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Customer - Số dư và lịch sử điểm tiêu dùng",
      querystring: querySchema,
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = Number(req.customerId);
      if (!Number.isSafeInteger(customerId) || customerId <= 0) {
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      }
      const { skip, limit, transactionType, fromDate, toDate } = req.query;
      const filters: Prisma.Sql[] = [Prisma.sql`"amount" > 0`];
      if (transactionType) {
        filters.push(
          Prisma.sql`"direction" = ${transactionType === "increase" ? "credit" : "debit"}`,
        );
      }
      if (fromDate !== undefined) {
        filters.push(Prisma.sql`"createdAt" >= ${BigInt(fromDate)}`);
      }
      if (toDate !== undefined) {
        filters.push(Prisma.sql`"createdAt" <= ${BigInt(toDate)}`);
      }
      const historyFilter = Prisma.join(filters, " AND ");

      try {
        const [transactions, countRows, balance] = await Promise.all([
          prismaClient.$queryRaw<PointHistoryRow[]>(Prisma.sql`
            WITH ledger AS (
              SELECT
                "id", "type", "direction", "amount", "sourceOrderId", "createdAt",
                SUM(CASE WHEN "direction" = 'credit' THEN "amount" ELSE -"amount" END)
                  OVER (ORDER BY "createdAt" ASC, "id" ASC) AS "balance"
              FROM "consumptionPointTransaction"
              WHERE "customerId" = ${customerId}
            )
            SELECT "type", "direction", "amount", "balance", "sourceOrderId", "createdAt"
            FROM ledger
            WHERE ${historyFilter}
            ORDER BY "createdAt" DESC, "id" DESC
            OFFSET ${skip}
            LIMIT ${limit}
          `),
          prismaClient.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
            SELECT COUNT(*)::bigint AS "total"
            FROM "consumptionPointTransaction"
            WHERE "customerId" = ${customerId} AND ${historyFilter}
          `),
          getConsumptionPointBalance(customerId),
        ]);

        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            // Số khả dụng và khoản đang giữ cho đơn chờ thanh toán.
            totalConsumptionPoint: balance.available,
            pendingOrderAmount: balance.reserved,
            items: transactions.map((transaction) => {
              const amount = point(transaction.amount);
              const isCredit = transaction.direction === "credit";
              return {
                createdAt: point(transaction.createdAt),
                type: transaction.type,
                typeName: typeName(transaction.type),
                content: content(transaction),
                changedPoint: isCredit ? amount : -amount,
                balance: point(transaction.balance),
                transactionType: isCredit ? "increase" : "decrease",
              };
            }),
            total: point(countRows[0]?.total),
            limit,
            skip,
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể lấy lịch sử điểm tiêu dùng lúc này",
        });
      }
    },
  });
};
