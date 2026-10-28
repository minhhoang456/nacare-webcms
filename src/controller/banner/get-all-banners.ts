import { bannerService } from '@root/src/services'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-all-banners`,
    schema: {
      tags: ['Banner'],
      summary: 'Banner - Lấy danh sách banner',
      description: 'Trả về danh sách tất cả banner đang hoạt động',
      querystring: z.object({
        position: z.enum(['Slider', 'TopRight', 'Middle']).optional(),
      }),
      response: {}
    },
    handler: async (_req: any, res) => {
      const { position } = _req.query
      try {
        const dataTemp = await bannerService.getAllBanners()

        const groupedData = dataTemp.reduce((acc: any, e: any) => {
          acc[e.vPosition] = acc[e.vPosition] || []
          acc[e.vPosition].push(e)
          return acc
        }, {})

        const dataFomart : any = {
          Slider: groupedData['Slider'],
          TopRight: groupedData['TopRight']?.slice(0, 2),
          Middle: groupedData['Middle'],
        }
        return res.send({ code: 0, message: 'Thành công', data: position ? dataFomart[position] : dataFomart })
      } catch(error) {
        return res.send({ code: -1, message: 'Hệ thống bận', data: [] })
      }
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
