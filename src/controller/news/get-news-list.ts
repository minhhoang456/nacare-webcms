import newsService from '@root/src/services/news'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod/v4'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-news-list`,
    schema: {
      tags: ['news'],
      summary: 'Tin tức - Lấy danh sách bài viết',
      description:
        'Lấy danh sách tin tức đang hoạt động, lọc theo chuyên mục (ưu đãi/sự kiện), có phân trang',
      querystring: z.object({
        category: z.enum(['uu_dai', 'su_kien']).optional(),
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .optional(),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .optional()
      }),
      response: {}
    },
    handler: async (req: any, res) => {
      try {
        const { category, skip = 0, limit = 10 } = req.query
        const { items, total } = await newsService.getListNews({
          category,
          skip,
          limit
        })

        return res.send({
          code: 0,
          message: 'Thành công',
          data: items,
          total
        })
      } catch (error: any) {
        return res.status(500).send({
          code: 1,
          message: 'Lỗi hệ thống',
          error: error.message
        })
      }
    }
  })
}
