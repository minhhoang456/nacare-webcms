import userMidlleware from '@root/src/middleware/user'
import { discountPublicService } from '@root/src/services'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/add-limiter-for-discount`,
    // Define your schema
    preHandler: [userMidlleware as any],
    schema: {
      body: z.object({
        queryInput: z.string().describe('examble input')
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req: any, res) => {
      const { id } = JSON.parse(req.body.queryInput)
      const discountLimitInfo =
        await discountPublicService.addLimiterForDiscount(id)

      return res.send({
        data: [discountLimitInfo]
      })
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
