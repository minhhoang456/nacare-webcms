import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import customerMiddleware from "@src/middleware/customer";
import { z } from "zod";
import { prismaClient } from "@root/src/utils/prisma";
import { OrderPaymentStatusEnum } from "@prisma/client";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-order-ship-info`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["product", "order"],
      description: "Lấy thông tin vận chuyển đơn hàng",
      summary: "Lấy thông tin vận chuyển đơn hàng",
      querystring: z.object({
        orderShipId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .describe("Mã đơn hàng"),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { orderShipId } = req.query;
        //@ts-ignore
        const customerId = req.customerId;
        const orderShipInfo = await prismaClient.ordership.findUnique({
          where: {
            id: orderShipId,
            customerId,
          },
        });
        if (!orderShipInfo) {
          return res.status(404).send({
            code: 1,
            message: "Đơn hàng không tồn tại",
          });
        }
        if (orderShipInfo.status === OrderPaymentStatusEnum.returnOrder) {
          const returnOrder = await prismaClient.orderReturns.findFirst({
            where: {
              orderId: orderShipInfo.orderId,
            },
          });
          if (returnOrder) {
            // @ts-ignore
            orderShipInfo.returnOrder = returnOrder;
          }
          const orderShipReturnInfo = await prismaClient.ordership.findFirst({
            where: {
              returnForOrderId: orderShipInfo.orderId,
            },
          });
          if (orderShipReturnInfo) {
            // @ts-ignore
            orderShipInfo.returnShipment = orderShipReturnInfo;
          } else {
            // @ts-ignore
            orderShipInfo.returnShipment = null;
          }
        }
        return res.status(200).send({
          code: 0,
          message: "Thành công",
          data: orderShipInfo,
        });
      } catch (err) {
        return res.status(500).send({
          code: 1,
          message: "Lỗi khi lấy thông tin vận chuyển đơn hàng",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
