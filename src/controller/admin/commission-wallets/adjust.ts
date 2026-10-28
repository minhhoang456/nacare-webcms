import { RoleSpecial } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import { prismaClient } from "@src/utils/prisma";

const bodySchema = z.object({
  customerId: z.number().int().positive(),
  walletType: z.enum([
    "direct",
    "small_branch",
    "accumulation",
    "positive",
    "resonance",
    "agency",
  ]),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(5).max(500),
  requestId: z.string().trim().min(1).max(100).optional(),
});

function vietnamDate(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/adjust",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Cộng thủ công vào ví hoa hồng theo mục",
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

      const { customerId, walletType, amount, reason, requestId } = req.body;
      const customer = await prismaClient.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!customer) {
        return res
          .code(404)
          .send({ code: 1, message: "Khách hàng không tồn tại" });
      }

      try {
        // Một bút toán tạo ra cả cập nhật ví mục và ví tổng nhờ trigger DB.
        // requestId giúp thao tác thủ công không thể được cộng trùng khi gọi lại.
        const transaction = await prismaClient.commissionTransaction.create({
          data: {
            idempotencyKey: `manual-adjustment:${requestId || randomUUID()}`,
            calculationDate: vietnamDate(),
            type: "manual_adjustment",
            direction: "credit",
            customerId,
            grossAmount: BigInt(amount),
            netAmount: BigInt(amount),
            amount: BigInt(amount),
            metadata: {
              walletType,
              reason,
              adminUserId: req.userId,
              requestId: requestId || null,
            },
            createdAt: BigInt(Date.now()),
          },
        });
        return res.send({
          code: 0,
          message: "Đã cộng tiền vào ví hoa hồng",
          data: { transactionId: String(transaction.id) },
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
