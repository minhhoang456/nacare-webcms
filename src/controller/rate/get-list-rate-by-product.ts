import ono from "@jsdevtools/ono";
import { rateService } from "@root/src/services";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-list-rate-by-product`,
    // Define your schema
    schema: {
      tags: ['Rate'],
      summary: 'Rate - Lấy danh sách đánh giá sản phẩm',
      description: 'Lấy danh sách đánh giá sản phẩm',
      querystring: z.object({
        productTypeId: z.string(),
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        star: z.enum(['5', '4', '3', '2', '1']).optional(),
        isTest: z.string().optional(),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        //@ts-ignore
        const { productTypeId, skip, limit, star } = req.query
        const rateTemps: any = await rateService.getInfoRateProduct(Number(productTypeId))
        if (!rateTemps) throw ono('e_get_rate_empty');
        let rates = rateTemps.filter((e: any) => e.isActive)
        if (star) rates = rates.filter((e: any) => e.star === Number(star))
        return res.send({
          code: 0,
          rates: rates.slice(skip, limit) || [],
          message: 'Thành công',
          total: rates?.length || 0,
        })
      } catch (error: any) {
        console.log(error)
        switch (error.message) {
          case 'e_get_rate_empty':
            return res.send({ code: -1, message: 'Chưa có đánh giá nào', rates: [] })
          default:
            return res.send({ code: -1, message: 'Lỗi hệ thống' })
        }
      }
    },
  });
};