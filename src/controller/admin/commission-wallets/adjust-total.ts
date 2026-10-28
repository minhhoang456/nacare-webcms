import { RoleSpecial, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import { prismaClient } from "@src/utils/prisma";
import { getCommissionWalletAvailable } from "@root/src/services/commissionWalletOrderPayment.service";

const bodySchema = z.object({
  customerId: z.number().int().positive().max(2147483647),
  amount: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
    .refine((value) => value !== 0, "Số tiền điều chỉnh phải khác 0"),
});

function vietnamDate(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/adjust-total",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Cộng hoặc trừ ví hoa hồng tổng của một khách hàng",
      description: "amount dương để cộng, âm để trừ.",
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

      const { customerId, amount } = req.body;
      const direction = amount > 0 ? "credit" : "debit";
      const absoluteAmount = BigInt(Math.abs(amount));
      const operationId = randomUUID();

      try {
        const result = await prismaClient.$transaction(async (tx) => {
          // Cùng khóa với luồng rút tiền và trigger đồng bộ ví.
          await tx.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
            SELECT 1 AS locked FROM pg_advisory_xact_lock(170614, ${customerId})
          `);
          const customer = await tx.customer.findUnique({
            where: { id: customerId },
            select: { id: true },
          });
          if (!customer) return { status: "not_found" as const };

          const availableAmount = BigInt(
            await getCommissionWalletAvailable(customerId, tx),
          );
          if (direction === "debit" && absoluteAmount > availableAmount) {
            return { status: "insufficient" as const };
          }

          const transaction = await tx.commissionTransaction.create({
            data: {
              idempotencyKey: `manual-total-adjustment:${operationId}`,
              runId: null,
              calculationDate: vietnamDate(),
              type: "manual_adjustment",
              direction,
              customerId,
              grossAmount:
                direction === "credit" ? absoluteAmount : availableAmount,
              deductionAmount:
                direction === "debit" ? absoluteAmount : BigInt(0),
              netAmount:
                direction === "credit"
                  ? absoluteAmount
                  : availableAmount - absoluteAmount,
              amount: absoluteAmount,
              metadata: {
                walletType: "other",
                reason: "Admin điều chỉnh số dư hoa hồng",
                adminUserId: req.userId,
                operationId,
                action: direction,
              },
              createdAt: BigInt(Date.now()),
            },
          });
          return { status: "created" as const, transaction };
        });

        if (result.status === "not_found") {
          return res
            .code(404)
            .send({ code: 1, message: "Khách hàng không tồn tại" });
        }
        if (result.status === "insufficient") {
          return res.code(422).send({
            code: 1,
            message: "Số tiền trừ vượt quá số dư hoa hồng khả dụng",
          });
        }
        return res.send({
          code: 0,
          message:
            direction === "credit"
              ? "Đã cộng tiền vào ví hoa hồng"
              : "Đã trừ tiền khỏi ví hoa hồng",
          data: {
            transactionId: String(result.transaction.id),
            customerId,
            amount,
            direction,
          },
        });
      } catch (error: any) {
        if (error?.code === "P2002") {
          return res
            .code(409)
            .send({ code: 1, message: "Yêu cầu đã được xử lý" });
        }
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể điều chỉnh ví hoa hồng lúc này",
        });
      }
    },
  });
};
