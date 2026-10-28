import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import customerMiddleware from "@root/src/middleware/customer";
import { z } from "zod";
import { prismaClient } from "@root/src/utils/prisma";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/cancel-return-order`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["order"],
      description: "Hủy đơn hàng trả hàng",
      summary: "Hủy đơn hàng trả hàng",
      body: z.object({
        orderReturnId: z.number().describe("Mã đơn hàng trả hàng"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { orderReturnId } = req.body;
        const orderReturn = await prismaClient.orderReturns.findUnique({
          where: { id: orderReturnId },
        });
        if (!orderReturn) {
          return res
            .status(400)
            .send({ code: 1, message: "Đơn hàng trả hàng không tồn tại" });
        }
        const statusAllowCancel = ["PENDING", "DISPUTE"];
        if (!statusAllowCancel.includes(orderReturn.status)) {
          return res
            .status(400)
            .send({ code: 1, message: "Đơn hàng trả hàng không thể hủy" });
        }
        const returnMessages = orderReturn.returnMessages as any[];
        returnMessages.push({
          time: new Date().getTime(),
          message: "Đã hủy đơn trả hàng",
        });
        await prismaClient.orderReturns.update({
          where: { id: orderReturnId },
          data: {
            status: "REJECTED",
            returnMessages,
          },
        });
        return res
          .status(200)
          .send({ code: 0, message: "Đơn hàng trả hàng đã được hủy" });
      } catch (error) {
        return res.status(500).send({ code: 1, message: "Lỗi server" });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
