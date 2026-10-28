import categoryService from "@root/src/services/category.service";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-categories-store`,
    // Define your schema
    schema: {
      tags: ["category"],
      summary: "Lấy danh sách category của store",
      description: "Lấy danh sách category của store",
      // body: z.object({
      // }),
      querystring: z.object({
        storeId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { storeId } = req.query;
        const categories = await categoryService.getCategoriesOfStore(storeId);
        return res.send({
          code: 0,
          message: "Thành công",
          data: categories,
        });
      } catch (error: any) {
        return res.status(500).send({
          code: 1,
          message: "Đã có lỗi xảy ra",
          error: error.message,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
