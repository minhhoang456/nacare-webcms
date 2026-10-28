import customerMiddleware from '@root/src/middleware/customer'
import { discountService } from '@root/src/services'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/get-discount-info`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      body: z.object({
        discountCode: z.string()
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req: any, res) => {
      try {
        const { discountCode } = req.body
        const discountInfo =
          await discountService.getCodeInfoByCode(discountCode)
        return res.send({ code: 0, discountInfo })
      } catch (error: any) {
        switch (error.code) {
          case 'code_is_not_valid':
            return { code: 1, message: 'Code không đúng' }
          case 'code_is_used':
            return { code: 2, message: 'Code đã được sử dụng' }
          case 'code_is_expired':
            return { code: 3, message: 'Code hết hiệu lực' }
          default:
            return { code: -1, message: 'Hệ thống bận, vui lòng thử lại' }
        }
      }
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
