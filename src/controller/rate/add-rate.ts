import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import ono from "@jsdevtools/ono";
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/add-rate`,
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Rate"],
      summary: "Rate - Đánh giá sản phẩm",
      description: "Đánh giá sản phẩm",
      body: z.object({
        orderShipId: z.number(),
        listRate: z.array(z.object({
          star: z.number(),
          comment: z.string().optional(),
          images: z.array(z.string()).optional(),
          videos: z.array(z.string()).optional(),
          name: z.string(),
          itemId: z.number().min(1),
        })),
        isTest: z.boolean().optional(),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { orderShipId, listRate } = req.body;
        const customerId = req.customerId;
        const { productTypes, orderId } = await getOrderInfo(orderShipId);

        const createRateData = (item: any, orderItemInfos: any) => {
          const productType = orderItemInfos?.find((orderitem: any) => item.id === orderitem.itemId);
          return {
            ...item,
            orderId,
            customerId,
            itemId: productType?.id || null,
            productTypeId: productType?.productTypeId || null,
            storeId: productType?.storeId || null,
            isActive: true
          };
        };

        const rateData = listRate.map((item: any) => createRateData(item, productTypes));
        await Promise.all([
          prismaClient.rate.createMany({
            data: rateData
          }),
          prismaClient.order.update({
            where: { id: orderId },
            data: { isFeedback: true }
          }),
          prismaClient.ordership.update({
            where: { id: orderShipId },
            data: { isFeedback: true }
          })
        ])

        return res.send({
          code: 0,
          message: "Đánh giá thành công!",
        });
      } catch (error: any) {
        return res.status(400).send({
          code: 1,
          message: msg[error.message] || "Hệ thống bận xin vui lòng thử lại ",
          ...(error.itemId && { message: 'Không tìm thấy sản phẩm để đánh giá trong đơn hàng có id: ' + error.itemId }),
        });
      }
    },
  });
};

async function getOrderInfo(orderShipId: number, customerId?: number) {
  const ordership = await prismaClient.ordership.findUnique({
    where: { id: orderShipId, status: 'completed', customerId },
    select: {
      id: true,
      isFeedback: true,
      orderId: true,
      orderItemInfos: true,
    }
  })
  if (!ordership) throw ono("e_get_rate_order_not_found");
  if (ordership.isFeedback) throw ono("e_get_rate_2_time");

  const orderItemInfos: any = ordership?.orderItemInfos;
  const typeIds = orderItemInfos?.map((item: any) => item.typeId);
  const productTypes = await prismaClient.product.findMany({
    where: { id: { in: typeIds } },
    select: { id: true, itemId: true, productTypeId: true , storeId : true }
  });
  return {
    orderId: ordership?.orderId,
    productTypes: productTypes.map((item: any) => ({
      id: item.id,
      productTypeId: item.productTypeId,
      storeId: orderItemInfos.find((orderitem: any) => orderitem.typeId === item.id)?.storeId || item?.storeId
    }))
  };
}

const msg: any = {
  e_get_rate_order_not_found: "Đơn hàng không tồn tại",
  e_get_rate_2_time: "Bạn đã đánh giá trước đó rồi.",
}