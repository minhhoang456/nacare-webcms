import { Prisma, RoleSpecial } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import { prismaClient } from "@src/utils/prisma";

const bodySchema = z.object({
  customerId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  amount: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
    .refine((amount) => amount !== 0, "Số tiền phải khác 0"),
  reason: z.string().trim().min(5).max(500).optional(),
});

function money(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error("accumulation entitlement amount is not a safe integer");
  }
  return result;
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/entitlements",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Điều chỉnh hạn mức tiêu dùng tích sản thủ công",
      description:
        "Số tiền dương tăng, số tiền âm giảm hạn mức Mục 2. Không được giảm quá hạn mức chưa nhận. Điều chỉnh thủ công chưa tham gia cron phân phối và không thay đổi tiền hoa hồng có thể rút.",
      body: bodySchema,
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

      const { customerId, amount, reason } = req.body;
      try {
        const result = await prismaClient.$transaction(async (tx) => {
          const customer = await tx.customer.findUnique({
            where: { id: customerId },
            select: { id: true },
          });
          if (!customer) return { status: "not_found" as const };

          // Cùng khóa với refresh_commission_wallet_base: không giữ row lock
          // trong lúc một trigger khác đang chờ cập nhật ví, tránh deadlock.
          await tx.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
            SELECT 1 AS locked
            FROM pg_advisory_xact_lock(170614, ${customerId})
          `);

          // Advisory lock phía trên đã tuần tự hóa các lần cập nhật cùng
          // customer với trigger đồng bộ ví. Chỉ SELECT ở đây: FOR UPDATE
          // đòi quyền UPDATE trên commissionWallet, trong khi API chỉ có SELECT.
          // Phần đã nhận không bị thu hồi; chỉ được trừ hạn mức còn lại.
          const walletBefore = await tx.$queryRaw<
            Array<{
              totalEntitlementAmount: bigint;
              totalAccumulatedAmount: bigint;
            }>
          >(Prisma.sql`
            SELECT "entitlementAmount" AS "totalEntitlementAmount",
              "receivedAmount" AS "totalAccumulatedAmount"
            FROM "commissionWallet"
            WHERE "customerId" = ${customerId} AND "walletType" = 'accumulation'
          `);
          if (
            amount < 0 &&
            (walletBefore[0]?.totalEntitlementAmount ?? BigInt(0)) -
              (walletBefore[0]?.totalAccumulatedAmount ?? BigInt(0)) <
              BigInt(-amount)
          ) {
            return { status: "insufficient_entitlement" as const };
          }

          // Mỗi lần điều chỉnh là một dòng lịch sử riêng; trigger đồng bộ ví.
          const now = BigInt(Date.now());
          const grantId = randomUUID();
          const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            INSERT INTO "accumulationManualEntitlement"
              ("id", "idempotencyKey", "customerId", "groupName",
                "maximumAmount", "receivedAmount", "remainingAmount",
                "reason", "adminUserId", "createdAt", "updatedAt")
            VALUES (${grantId}::uuid,
              ${`manual-accumulation:${grantId}`}, ${customerId}, NULL,
              ${BigInt(amount)}, 0, ${BigInt(amount)}, ${reason || ""},
              ${req.userId}, ${now}, ${now})
            RETURNING "id"::text AS "id"
          `);

          const wallet = await tx.$queryRaw<
            Array<{
              totalEntitlementAmount: bigint;
              totalAccumulatedAmount: bigint;
            }>
          >(Prisma.sql`
            SELECT "entitlementAmount" AS "totalEntitlementAmount",
              "receivedAmount" AS "totalAccumulatedAmount"
            FROM "commissionWallet"
            WHERE "customerId" = ${customerId} AND "walletType" = 'accumulation'
          `);
          if (!wallet.length) {
            throw new Error("accumulation wallet was not synchronized");
          }
          return {
            status: "created" as const,
            id: rows[0].id,
            totalEntitlementAmount: money(wallet[0].totalEntitlementAmount),
            totalAccumulatedAmount: money(wallet[0].totalAccumulatedAmount),
          };
        });

        if (result.status === "not_found") {
          return res
            .code(404)
            .send({ code: 1, message: "Khách hàng không tồn tại" });
        }
        if (result.status === "insufficient_entitlement") {
          return res.code(400).send({
            code: 1,
            message: "Số tiền trừ vượt hạn mức tích sản chưa được nhận",
          });
        }
        return res.send({
          code: 0,
          message:
            amount > 0 ? "Đã cộng hạn mức tích sản" : "Đã trừ hạn mức tích sản",
          data: {
            id: result.id,
            totalEntitlementAmount: result.totalEntitlementAmount,
            totalAccumulatedAmount: result.totalAccumulatedAmount,
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể điều chỉnh hạn mức tích sản lúc này",
        });
      }
    },
  });
};
