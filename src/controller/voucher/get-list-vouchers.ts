import customerMiddleware from '@root/src/middleware/customer';
import { voucherService } from '@root/src/services';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/get-list-vouchers`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ['Voucher'],
      body: z.object({
        skip: z.number().optional().describe('Số lượng bỏ qua'),
        limit: z.number().optional().describe('Số lượng lấy'),
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
        
        const vouchers = await voucherService.getListVouchers({
          customerId,
          skip: skip || 0,
          limit: limit || 1000,
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
