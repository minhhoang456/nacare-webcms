import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prismaClient } from "@root/src/utils/prisma";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/check-order-return`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        orderReturnId: z.number().describe("Mã đơn trả hàng"),
        status: z.enum(["APPROVED", "REJECTED"]).describe("Trạng thái"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { orderReturnId, status } = req.body;
        const orderReturn = await prismaClient.orderReturns.findUnique({
          where: {
            id: orderReturnId,
            status: "CHECK_PRODUCT",
          },
        });

        if (!orderReturn) {
          return res.status(400).send({
            code: 1,
            message: "Đơn trả hàng không tồn tại",
          });
        }
        if (status === "APPROVED") {
          await prismaClient.orderReturns.update({
            where: { id: orderReturnId },
            data: { status: "WAITING_MONEY_RETURN" },
          });
          return res.status(200).send({
            code: 0,
            message: "Đã duyệt đơn trả hàng",
          });
        }

        if (status === "REJECTED") {
          await prismaClient.orderReturns.update({
            where: { id: orderReturnId },
            data: { status: "DISPUTE_IN_CHECKING" },
          });
          return res.status(200).send({
            code: 0,
            message:
              "Đã từ chối đơn trả hàng. Hãy liên hệ với sàn để giải quyết. Đơn trả hàng sẽ được chuyển về trạng thái tranh chấp",
          });
        }
      } catch (err) {
        throw new Error("Lỗi khi kiểm tra đơn trả hàng");
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
