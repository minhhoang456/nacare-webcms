import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import voucherHelper from '../../helpers/voucher.helpers'
import rootMiddleware from '@root/src/middleware/root'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/init-cache-limit-voucher`,
    preHandler: [rootMiddleware as any],
    // Define your schema
    schema: {
      body: z.object({
        voucherId: z.number().describe('Id của voucher').optional()
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req, res) => {
      try {
        const { voucherId } = req.body
        await voucherHelper.initCacheLimitVoucher(voucherId)
        return res.send({ code: 0, message: 'Thành công' })
      } catch (err: any) {
        return res.send({ code: 1, message: err.message })
      }
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
