import customerMiddleware from '@root/src/middleware/customer';
import VoucherCodeService from '@root/src/utils/voucher.code';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/my-vouchers`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ['Voucher'],
      body: z.object({
        skip: z.number().optional().default(0),
        limit: z.number().optional().default(10),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        //@ts-ignore
        const customerId = req.customerId;
        const { skip, limit } = req.body;
        const vouchers =
          await VoucherCodeService.getInstance().getApplicableVoucherCodes({
            customerId,
            skip,
            limit,
          });
        return res.send({ code: 0, message: 'Success', data: vouchers });
      } catch (error) {
        return res.send({
          code: 1,
          message: 'Không thể lấy danh sách voucher',
          data: [],
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
