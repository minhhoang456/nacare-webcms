import rootMiddleware from '@root/src/middleware/root'
import { cronJobService } from './../../services/cronJob'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import * as services from '@src/services/index'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/init-cache`,
    preHandler: [rootMiddleware as any],
    // Define your schema
    schema: {
      body: z.object({
        model: z.string().optional().describe('Khởi tạo cache cho service nào')
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req, res) => {
      const { model } = req.body
      const models: any = services
      if (model) {
        if ((models as any)[model]?.initCache) {
          const rs = await models[model].initCache()
          return res.send({ code: 0, rs })
        } else {
          return { code: 1, message: 'Không tìm thấy hàm initCache' }
        }
      }
      for (const index in models) {
        const model = models[index]
        if (model.initCache) {
          try {
            cronJobService.addInitItem({
              modelName: index,
              type: 'init-cache'
            })
          } catch (error) {
            console.error('init cache error ', error)
          }
        }
      }
      return res.send({ code: 0, message: 'Thành công' })
    }
  })
}
