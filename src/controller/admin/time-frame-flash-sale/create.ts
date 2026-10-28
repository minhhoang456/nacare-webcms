import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import userMidlleware from '@src/middleware/user'
import pageMiddleware from '@src/middleware/page'
import actionLogMidlleware from '@root/src/middleware/actionLog'
import { prismaClient } from '@root/src/utils/prisma'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/create`,
    preHandler: [userMidlleware as any, pageMiddleware, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        name: z.string().describe('Tên chương trình khuyến mãi'),
        startHour: z
          .number()
          .min(0)
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        endHour: z
          .number()
          .min(0)
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        isActive: z
          .boolean()
          .optional()
          .default(true)
          .describe('Trạng thái chương trình khuyến mãi')
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req, res) => {
      try {
        const { name, startHour, endHour, isActive } = req.body
        // check start hour and end hour integer
        if (
          Number.isInteger(startHour) === false ||
          Number.isInteger(endHour) === false
        ) {
          return res.send({
            code: 1,
            message: 'Giờ phải là số nguyên'
          })
        }
        if (endHour > 23 || startHour > 23 || startHour > endHour) {
          return res.send({
            code: 1,
            message: 'Giờ không hợp lệ'
          })
        }
        await prismaClient.timeFrameFlashSale.create({
          data: {
            name,
            startHour,
            endHour,
            isActive
          }
        })
        return res.send({
          code: 0,
          message: 'Thành công'
        })
      } catch (err) {
        return res.code(400).send({
          code: 1,
          message: 'Hệ thống bận!'
        })
      }
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
