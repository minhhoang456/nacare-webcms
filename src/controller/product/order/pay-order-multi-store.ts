import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import customerMiddleware from "@root/src/middleware/customer";
import { z } from "zod";
import { prismaClient } from "@root/src/utils/prisma";
import paymentHelper from "@root/src/helpers/payment.helper";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/pay-order-multi-store`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["order"],
      description: "Thanh toán đơn hàng",
      summary: "Thanh toán đơn hàng",
      body: z.object({
        requestId: z.string().describe("ID yêu cầu"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { requestId } = req.body;
        //@ts-ignore
        const customerId = req.customerId;
        const orderInfos = await prismaClient.order.findMany({
          where: {
            requestId,
            customerId,
            isMultiStore: false,
            paymentStatus: "processing",
          },
        });
        if (orderInfos.length === 0) {
          return res.send({
            code: 1,
            message: "Không có đơn hàng chờ thanh toán",
          });
        }
        // Create new order with summary total money
        const newOrder = await prismaClient.order.create({
          data: {
            customerId,
            totalMoney: orderInfos.reduce(
              (acc, order) => acc + (order.totalMoney || 0),
              0,
            ),
            moneyPaid: orderInfos.reduce(
              (acc, order) => acc + (order.moneyPaid || 0),
              0,
            ),
            consumptionPointUsed: orderInfos.reduce(
              (acc, order) => acc + (order.consumptionPointUsed || BigInt(0)),
              BigInt(0),
            ),
            commissionWalletUsed: orderInfos.reduce(
              (acc, order) => acc + (order.commissionWalletUsed || BigInt(0)),
              BigInt(0),
            ),
            requestId,
            isMultiStore: true,
          },
        });
        // Create link payment
        const paymentUrl =
          await paymentHelper.handleOnlinePaymentMultiStore(newOrder);
        return res.send({
          code: 0,
          message: "Tiến hành thanh toán",
          data: { paymentUrl },
        });
      } catch (err) {
        console.log(err);
        return res.send({
          code: 1,
          message: "Đã có lỗi xảy ra, vui lòng thử lại sau",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
