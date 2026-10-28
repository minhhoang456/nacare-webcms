import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@src/utils/prisma";
import { OrderPaymentStatusEnum, Prisma } from "@prisma/client";
import Conf from "@src/services/conf";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/return-order`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["order"],
      description: "Tạo yêu cầu trả hàng",
      summary: "Tạo yêu cầu trả hàng",
      body: z.object({
        orderId: z.number().describe("Mã đơn hàng"),
        title: z.string().describe("Tiêu đề"),
        description: z.string().describe("Mô tả"),
        images: z.array(z.string()).describe("Ảnh").optional(),
        orderItemIdsReturn: z
          .array(z.number())
          .describe("Danh sách sản phẩm trả hàng"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { orderId, title, description, images, orderItemIdsReturn } =
          req.body;
        //@ts-ignore
        const customerId = req.customerId;
        const returnOrder = await prismaClient.orderReturns.findFirst({
          where: {
            orderId,
          },
        });
        if (returnOrder) {
          return res.status(400).send({
            code: 1,
            message: "Bạn đã tạo yêu cầu trả hàng cho đơn hàng này",
          });
        }
        const timeAllowReturn = Conf.get(
          "TIME_ALLOW_RETURN_ORDER",
          1000 * 60 * 60 * 24 * 3
        );
        const order = await prismaClient.order.findFirst({
          where: {
            id: orderId,
            customerId,
            paymentStatus: OrderPaymentStatusEnum.completed,
            timeCompletedOrder: {
              gt: Date.now() - timeAllowReturn,
            },
          },
        });
        if (!order) {
          return res.status(400).send({
            code: 1,
            message: "Đơn hàng không tồn tại",
          });
        }
        const orderShipInfo = await prismaClient.ordership.findFirst({
          where: {
            orderId,
          },
        });
        if (!orderShipInfo) {
          return res.status(400).send({
            code: 1,
            message: "Đơn hàng không tồn tại",
          });
        }
        const orderItems = await prismaClient.orderitem.findMany({
          where: {
            id: {
              in: orderItemIdsReturn,
            },
            orderId,
          },
        });
        if (orderItems.length !== orderItemIdsReturn.length) {
          return res.status(400).send({
            code: 1,
            message: "Sản phẩm không tồn tại",
          });
        }
        const totalProductPrice = orderItems.reduce(
          (acc, item) => acc + (item?.totalPrice || 0),
          0
        );
        const totalDiscountPrice = orderItems.reduce(
          (acc, item) => acc + (item?.discount || 0),
          0
        );
        const totalMoneyReturn = totalProductPrice - totalDiscountPrice;
        const dataReturnOrder: Prisma.OrderReturnsCreateInput = {
          description: description,
          images: images,
          orderId: orderId,
          title: title,
          totalProductPrice: totalProductPrice,
          totalDiscountPrice: totalDiscountPrice,
          totalMoneyReturn: totalMoneyReturn,
          orderItemInfos: orderItems as any,
          customerId: customerId,
          storeInfo: orderShipInfo.storeInfo as any,
          returnMessages: [
            {
              time: new Date().getTime(),
              message: "Tạo yêu cầu trả hàng",
            },
          ],
        };
        const returnOrderCreated = await prismaClient.$transaction(
          async (tx) => {
            const returnOrder = await tx.orderReturns.create({
              data: dataReturnOrder,
            });
            await tx.order.update({
              where: {
                id: orderId,
              },
              data: {
                paymentStatus: OrderPaymentStatusEnum.returnOrder,
              },
            });
            await tx.ordership.updateMany({
              where: {
                orderId,
              },
              data: {
                status: OrderPaymentStatusEnum.returnOrder,
              },
            });
            return returnOrder;
          }
        );
        return res.send({
          code: 0,
          message: "Tạo yêu cầu trả hàng thành công",
          data: returnOrderCreated,
        });
      } catch (err) {
        console.log(err);
        return res.status(500).send({
          code: 1,
          message: "Lỗi hệ thống",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
