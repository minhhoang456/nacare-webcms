import { categoryService } from "@root/src/services";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-categories`,
    // Define your schema
    schema: {
      tags: ["category"],
      summary: "Category - Lấy danh sách category",
      description: "Lấy danh sách tất cả category đang hoạt động",
      // body: z.object({
      //   merchantId: z.number().optional()
      // }),
      querystring: z.object({
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .optional()
          .describe("Số lượng bỏ qua"),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .optional()
          .describe("Số lượng lấy"),
        isHot: z.string().optional().describe("Lấy danh sách category hot"),
        isParent: z.string().optional().describe("Lấy danh sách lĩnh vực cha"),
        categoryId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .optional()
          .describe("Lấy danh sách category con của categoryId"),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { skip, limit, isHot, isParent, categoryId } = req.query;
        const { data, total } = await categoryService.getListCategory({
          skip,
          limit,
          isHot: isHot === "true",
          isParent: isParent === "true",
          categoryId,
        });
        return res.status(200).send({
          code: 0,
          data,
          total,
        });
      } catch (err) {
        console.error("Get list brand error", err);
        return res.status(500).send({
          code: 1,
          message: "Đã có lỗi xảy ra",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
