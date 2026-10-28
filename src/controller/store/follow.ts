import customerMiddleware from '@root/src/middleware/customer'
import { prismaClient } from '@root/src/utils/prisma'
import redis from '@root/src/utils/redis'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/follow-store`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ['Store'],
      description: 'Theo dõi cửa hàng',
      body: z.object({
        storeId: z.number()
      }),
      response: {}
    },
    handler: async (req, res) => {
      //@ts-ignore
      const customerId = req.customerId
      const { storeId } = req.body
      try {
        const flow = await toggleFollow(storeId, customerId)
        return res.send({
          code: 0,
          message: 'Success',
          flow,
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


const toggleFollow = async (storeId: number, customerId: number) => {
  const key = `follow_store_customerId_${customerId}`
  const flow = await redis.sadd(key, storeId)

  if (!flow) {
    await prismaClient.storeFollow.deleteMany({ where: { storeId, customerId } })
    await redis.srem(key, storeId)
  }
  else {
    await prismaClient.storeFollow.create({ data: { storeId, customerId } })
  }
  return flow
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
