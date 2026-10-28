import { brandService } from '@root/src/services/brand.service';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-list-brand`,
    // Define your schema
    schema: {
      tags: ['brand'],
      description: 'Lấy danh sách thương hiệu',
      summary: 'Lấy danh sách thương hiệu',
      // body: z.object({
      // }),
      querystring: z.object({
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        isHot: z.string().optional(),
        categoryId: z.string().optional(),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { skip, limit, isHot, categoryId } = req.query;
        const { data, total } = await brandService.getListBrand({
          skip,
          limit,
          ...(isHot ? { isHot: true } : {}),
          ...(categoryId ? { categoryId: Number(categoryId) } : {}),
        });
        return res.status(200).send({
          code: 0,
          data,
          total,
        });
      } catch (err) {
        console.error('Get list brand error', err);
        return res.status(500).send({
          code: 1,
          message: 'Đã có lỗi xảy ra',
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
