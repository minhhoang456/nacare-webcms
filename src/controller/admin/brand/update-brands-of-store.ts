import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMidlleware from "@root/src/middleware/user";
import actionLogMidlleware from "@root/src/middleware/actionLog";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/update-brands-of-store`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        brandIds: z.array(z.number()).describe("ID của các thương hiệu"),
        storeId: z.number().describe("ID của cửa hàng"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { brandIds, storeId } = req.body;
        const brandStore = await prismaClient.brandStore.findFirst({
          where: {
            storeId
          },
        });
        if (!brandStore) {
          await prismaClient.brandStore.create({
            data: {
              storeId: storeId,
              brandId: brandIds,
            },
          });
          return res.code(200).send({
            code: 0,
            message: "Cập nhật thành công",
          });
        }

        if (brandStore.storeId !== storeId) {
          return res.code(400).send({
            code: 400,
            message: "Cửa hàng không hợp lệ",
          });
        }
        await prismaClient.brandStore.update({
          where: {
            id: brandStore.id,
          },
          data: {
            brandId: brandIds,
          },
        });
        return res.code(200).send({
          code: 0,
          message: "Cập nhật thành công",
        });
      } catch (error) {
        console.log(error);
        return res.code(500).send({
          code: 500,
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
