// import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
// import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-flashsale-product-info`,
    // preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["flash-sale"],
      description: "Get flash sale product info",
      summary: "Get flash sale product info",
      // body: z.object({
      // }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (_req, res) => {
      try {
        const now = new Date().getTime();
        const flashSaleProductInfo =
          await prismaClient.flashSaleProduct.findFirst({
            where: {
              isActive: true,
              startTime: {
                lte: now,
              },
              endTime: {
                gte: now,
              },
            },
            orderBy: {
              createdAt: "desc",
            },
          });
        if (!flashSaleProductInfo) {
          return res.status(404).send({
            code: 1,
            message: "Không tìm thấy thông tin flash sale product",
          });
        } else {
          return res.status(200).send({
            code: 0,
            message: "Lấy thông tin flash sale voucher thành công",
            data: flashSaleProductInfo,
          });
        }
      } catch (err) {
        return res.status(500).send({
          code: 1,
          message: "Đã có lỗi xảy ra, vui lòng thử lại",
          err,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
