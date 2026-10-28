import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import OrderReturnsService from "@root/src/services/OrderReturns.service";
import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/confirm-return-order`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        orderReturnId: z.number().describe("Mã đơn hàng"),
        status: z.enum(["APPROVED", "REJECTED"]).describe("Trạng thái"),
        isReturningItems: z.boolean().describe("Trả hàng").optional(),
        cancelRejectReason: z.string().describe("Lý do từ chối").optional(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { orderReturnId, status, isReturningItems, cancelRejectReason } =
          req.body;
        const returnOrder = await prismaClient.orderReturns.findUnique({
          where: {
            id: orderReturnId,
            status: "PENDING",
          },
        });
        if (!returnOrder) {
          return res
            .status(400)
            .send({ code: 1, message: "Đơn hàng không tồn tại" });
        }
        const returnMessages = returnOrder.returnMessages as any[];
        if (status === "REJECTED") {
          if (!cancelRejectReason) {
            return res.status(400).send({
              code: 1,
              message: "Lý do từ chối không được để trống",
            });
          }
          returnMessages.push({
            time: new Date().getTime(),
            message: "Đã từ chối đơn trả hàng",
          });
          await prismaClient.orderReturns.update({
            where: {
              id: orderReturnId,
            },
            data: {
              cancelRejectReason,
              status: "REJECTED",
              returnMessages,
            },
          });
        }
        if (status === "APPROVED") {
          returnMessages.push({
            time: new Date().getTime(),
            message: "Đã duyệt đơn trả hàng",
          });
          if (isReturningItems === undefined) {
            return res.status(400).send({
              code: 1,
              message: "Trả hàng không được để trống",
            });
          }
          if (isReturningItems) {
            await prismaClient.orderReturns.update({
              where: {
                id: orderReturnId,
              },
              data: {
                status: "BACK_TO_STORE",
                returnMessages,
              },
            });
            await OrderReturnsService.createShippingReturnOrder(orderReturnId);
          } else {
            await prismaClient.orderReturns.update({
              where: {
                id: orderReturnId,
              },
              data: {
                status: "WAITING_MONEY_RETURN",
                returnMessages,
              },
            });
          }
        }
        return res.status(200).send({ code: 0, message: "Thành công" });
      } catch (err) {
        console.log(err);
        return res.status(500).send({ message: "Lỗi server" });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
