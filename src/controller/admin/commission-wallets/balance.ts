import { Prisma, RoleSpecial } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import { prismaClient } from "@src/utils/prisma";

const querySchema = z.object({
  customerId: z.coerce.number().int().positive().max(2147483647),
});

function money(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new Error("Số dư hoa hồng vượt giới hạn số nguyên an toàn");
  }
  return amount;
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/balance",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Xem số dư ví hoa hồng của khách hàng",
      querystring: querySchema,
      response: {},
    },
    handler: async (req: any, res) => {
      if (
        req.roleSpecial !== RoleSpecial.ROOT &&
        req.roleSpecial !== RoleSpecial.ADMIN
      ) {
        return res
          .code(403)
          .send({ code: 1, message: "Không có quyền truy cập" });
      }

      const { customerId } = req.query;
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

        // Withdrawal cũ có thể vẫn pending nhưng chưa ghi bút toán debit.
        // Khấu trừ riêng phần đó để số khả dụng khớp với API adjust-total.
        const rows = await prismaClient.$queryRaw<
          Array<{
            balance: bigint;
            reservedAmount: bigint;
            legacyPendingAmount: bigint;
            pendingOrderAmount: bigint;
            availableAmount: bigint;
          }>
        >(Prisma.sql`
          WITH wallet AS (
            SELECT COALESCE("balance", 0)::bigint AS "balance",
              COALESCE("reservedAmount", 0)::bigint AS "reservedAmount"
            FROM "commissionWallet"
            WHERE "customerId" = ${customerId} AND "walletType" = 'total'
          ), pending AS (
            SELECT COALESCE(SUM(w."amount"), 0)::bigint AS "legacyPendingAmount"
            FROM "commissionWithdrawal" w
            WHERE w."customerId" = ${customerId} AND w."status" = 'pending'
              AND NOT EXISTS (
                SELECT 1 FROM "commissionTransaction" t
                WHERE t."idempotencyKey" = 'withdrawal:' || w."id"::text
                  AND t."customerId" = w."customerId"
                  AND t."type" = 'withdrawal' AND t."direction" = 'debit'
              )
          ), pending_order AS (
            SELECT COALESCE(SUM("amount"), 0)::bigint AS "pendingOrderAmount"
            FROM "commissionWalletOrderReservation"
            WHERE "customerId" = ${customerId} AND "status" = 'pending'
          )
          SELECT COALESCE(wallet."balance", 0)::bigint AS "balance",
            COALESCE(wallet."reservedAmount", 0)::bigint AS "reservedAmount",
            pending."legacyPendingAmount", pending_order."pendingOrderAmount",
            (COALESCE(wallet."balance", 0) -
              COALESCE(wallet."reservedAmount", 0) -
              pending."legacyPendingAmount" -
              pending_order."pendingOrderAmount")::bigint AS "availableAmount"
          FROM pending CROSS JOIN pending_order LEFT JOIN wallet ON true
        `);

        const row = rows[0];
        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            customerId,
            balance: money(row?.balance ?? BigInt(0)),
            reservedAmount: money(row?.reservedAmount ?? BigInt(0)),
            legacyPendingAmount: money(row?.legacyPendingAmount ?? BigInt(0)),
            pendingOrderAmount: money(row?.pendingOrderAmount ?? BigInt(0)),
            availableAmount: money(row?.availableAmount ?? BigInt(0)),
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể tải số dư ví hoa hồng lúc này",
        });
      }
    },
  });
};
