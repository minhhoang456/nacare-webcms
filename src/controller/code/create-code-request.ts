import userMidlleware from '@root/src/middleware/user'
import { prismaClient } from '@root/src/utils/prisma'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/create-code-request`,
    // Define your schema
    preHandler: [userMidlleware as any],
    schema: {
      body: z.object({
        voucherId: z.number(),
        description: z.string().optional(),
        amount: z.number().or(z.string().regex(/\d+/).transform(Number)),
        provider: z.string().optional(),
        note: z.string().optional(),
        fileId: z.number()
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req: any, res) => {
      try {
        req.body.creatorId = req.userId
        req.body.type = 'voucher'
        req.body.codeType = 'import'
        await prismaClient.coderequest.create({ data: req.body })
        return res.send({
          code: 0,
          message: 'Thành công'
        })
      } catch (error) {
        console.log(error)
        return {
          code: -1,
          message: 'Hệ thống bận'
        }
      }
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
