import redis from '@root/src/utils/redis'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import Conf from '@src/services/conf'
import customerMiddleware from '@root/src/middleware/customer'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/get-list-partner`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ['partner'],
      summary: 'Get list partner',
      description: 'Get list partner',
      body: z.object({ like: z.boolean().optional() }),
      querystring: z.object({
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        keyword: z.string().optional().describe('Search by keyword'),
        isTest: z.string().optional(),
        isMostLike: z.enum(['true', 'false']).optional(),
      }),
      response: {}
    },
    handler: async (req, res) => {
      try {
        const { like } = req.body
        //@ts-ignore
        const customerId = req.customerId
        const inputs = req.query

        if (inputs.isTest === 'true') {
          return res.send({ code: 0, message: 'Success', data: [] })
        }
        let allPartner: any = await redis.get('all_partner_cache_remote')
        if (!allPartner) {
          return {
            code: 0,
            data: [],
            message: 'Success'
          }
        }
        allPartner = JSON.parse(allPartner)
        const cacheLikeIds = await redis.smembers(
          `customer_like_partner_customerId_${customerId}`
        )
        const likeIds = cacheLikeIds.map((i) => Number(i))
        let data = []
        for (let i = 0; i < allPartner.length; i++) {
          if (
            inputs.keyword &&
            allPartner[i].name
              .toUpperCase()
              .search((inputs.keyword ?? '').toUpperCase()) == -1
          ) {
            continue
          }
          allPartner[i].liked = likeIds.includes(allPartner[i].id)
          data.push(allPartner[i])
        }

        if (inputs.limit > Conf.get('LIMIT_GET_PARTNER', 10)) {
          inputs.limit = Conf.get('LIMIT_GET_PARTNER', 10)
        }
        if (inputs.isMostLike) {
          data = data.filter((i: any) => i.liked)
        }

        if (like) {
          data = data.filter((i: any) => i.totallike > 0)
        }

        return res.send({
          code: 0,
          message: 'Success',
          data: data.skip(inputs.skip).limit(inputs.limit),
          length: data.length
        })
      } catch (err) {
        return {
          code: 0,
          data: [],
          message: err
        }
      }
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
