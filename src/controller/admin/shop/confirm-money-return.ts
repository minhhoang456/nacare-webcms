import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import userMidlleware from "@root/src/middleware/user";
import actionLogMidlleware from "@root/src/middleware/actionLog";
import { z } from "zod";
import { prismaClient } from "@root/src/utils/prisma";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/confirm-money-return`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        orderReturnId: z.number().describe("Mã đơn hàng"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { orderReturnId } = req.body;
        const orderReturn = await prismaClient.orderReturns.findUnique({
          where: {
            id: orderReturnId,
          },
        });
        if (!orderReturn) {
          return res.status(400).send({
            code: 1,
            message: "Đơn hàng không tồn tại",
          });
        }
        if (orderReturn.status !== "WAITING_MONEY_RETURN") {
          return res.status(400).send({
            code: 1,
            message: "Đơn hàng không đang chờ hoàn tiền",
          });
        }
        const returnMessages = orderReturn.returnMessages as any[];
        returnMessages.push({
          time: new Date().getTime(),
          message: "Đã hoàn tiền",
        });
        await prismaClient.orderReturns.update({
          where: {
            id: orderReturnId,
          },
          data: {
            status: "COMPLETED",
            returnMessages: returnMessages,
          },
        });
        return res.status(200).send({
          code: 0,
          message: "Hoàn tiền thành công",
        });
      } catch (err) {
        return res.status(500).send({
          code: 1,
          message: "Lỗi server",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
