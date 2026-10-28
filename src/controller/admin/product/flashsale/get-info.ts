import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-info`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      // body: z.object({
      // }),
      querystring: z.object({
        flashSaleProductId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .describe("ID của chương trình khuyến mãi"),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { flashSaleProductId } = req.query;
        const flashSaleProductInfo =
          await prismaClient.flashSaleProduct.findUnique({
            where: {
              id: flashSaleProductId,
            },
          });

        if (!flashSaleProductInfo) {
          return res.status(404).send({
            code: 1,
            message: "Không tìm thấy chương trình khuyến mãi",
          });
        }
        const flashSaleProductDetails =
          await prismaClient.flashSaleProductDetail.findMany({
            where: {
              flashSaleProductId,
            },
            orderBy: { sequence: "asc" },
          });
        const productInfos = await prismaClient.product.findMany({
          where: {
            id: {
              in: flashSaleProductDetails.map((detail) => detail.productId),
            },
          },
        });
        const flashSaleProductDetailsWithProductInfo =
          flashSaleProductDetails.map((detail) => {
            const productInfo = productInfos.find(
              (product) => product.id === detail.productId
            );
            return {
              ...detail,
              productInfo,
            };
          });
        const response = {
          ...flashSaleProductInfo,
          flashSaleProductDetails: flashSaleProductDetailsWithProductInfo,
        };
        return res.status(200).send({
          code: 0,
          message: "Thành công",
          data: response,
        });
      } catch (err) {
        return res.status(500).send({
          code: 1,
          message: "Có lỗi xảy ra",
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
