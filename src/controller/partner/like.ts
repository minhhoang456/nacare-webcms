import customerMiddleware from '@root/src/middleware/customer'
import partnerLikeService from '@root/src/services/partnerlike.services'
import redis from '@root/src/utils/redis'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/like`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ['partner'],
      body: z.object({
        partnerId: z.number()
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req, res) => {
      //@ts-ignore
      const customerId = req.customerId
      const { partnerId } = req.body
      try {
        const liked = await partnerLikeService.toggleLike(partnerId, customerId)

        const isFirstLike = await redis.exists(
          `customer_first_like_${partnerId}_customerId_${customerId}`
        )
        // console.log(isFirstLike, 'isFirstLike')

        if (!isFirstLike) {
          await redis.set(
            `customer_first_like_${partnerId}_customerId_${customerId}`,
            partnerId
          )
        }

        await new Promise((resolve, reject) => {
          try {
            if (liked) {
              redis.sadd(
                `customer_like_partner_customerId_${customerId}`,
                partnerId
              )
            } else {
              redis.srem(
                `customer_like_partner_customerId_${customerId}`,
                partnerId
              )
            }
            resolve(true)
          } catch (error) {
            reject(error)
          }
        })
        return res.send({
          code: 0,
          message: 'Success',
          liked,
          isFirstLike
        })
      } catch (error) {
        return res.send({
          code: 1,
          message: 'Hệ thống bận vui lòng thử lại'
        })
      }
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
