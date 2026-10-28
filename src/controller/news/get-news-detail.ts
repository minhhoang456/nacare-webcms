import newsService from '@root/src/services/news'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod/v4'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: '/get-news-detail',
    schema: {
      tags: ['news'],
      summary: 'Tin tức - Lấy chi tiết bài viết',
      description: 'Lấy chi tiết một bài viết theo slug hoặc id (kèm nội dung)',
      querystring: z
        .object({
          id: z
            .number()
            .or(z.string().regex(/\d+/).transform(Number))
            .refine((n) => n > 0)
            .optional(),
          slug: z.string().min(1).optional()
        })
        .refine((q) => q.id != null || q.slug != null, {
          message: 'Cần truyền slug hoặc id'
        }),
      response: {}
    },
    handler: async (req: any, res) => {
      try {
        const { id, slug } = req.query

        const article = await newsService.getNewsDetail({
          id,
          slug
        })

        if (!article) {
          return res.send({
            code: 1,
            message: 'Không tìm thấy bài viết',
            data: null
          })
        }

        return res.send({
          code: 0,
          message: 'Thành công',
          data: article
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
