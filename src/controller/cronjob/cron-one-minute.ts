import Conf from '@src/services/conf'
import { cronJobService } from '@src/services/index'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/cron-one-minute`,
    // Define your schema
    schema: {
      // body: z.object({
      // }),
      querystring: z.object({
        auth: z.string().min(1).describe('Xác thực client call')
      }),
      response: {}
    },
    handler: async (req, res) => {
      try {
        const { auth } = req.query
        if (
          auth !==
          Conf.get('TECT_SECRET', 'a565d01e-3dd4-4464-b8e2-9d49e3a460d')
        ) {
          return res.code(403).send({
            code: 2,
            message: 'Unauthorized'
          })
        }
        const models: any = await import('@src/services/index')
        for (const index in models) {
          const model = models[index]
          if (model.runCronjob1) {
            try {
              cronJobService.addInitItem({
                modelName: index,
                type: 'one-minute'
              })
            } catch (error) {
              console.error('cron one minute error ', error)
            }
          }
        }
        if (Conf.get('ADD_LOG_CRON', 0)) {
          console.log('end cron 1 minute')
        }
        return res.send({
          code: 0,
          message: 'Thành công'
        })
      } catch (error) {
        return res.code(500).send({
          code: 1,
          message: error
        })
      }
    }
  })
}
