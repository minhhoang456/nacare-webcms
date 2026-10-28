import customerMiddleware from '@root/src/middleware/customer';
import voucherService from '@root/src/services/voucher.service';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/claim`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ['Voucher'],
      body: z.object({
        voucherId: z.number(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      //@ts-ignore
      const customerId = req.customerId;
      const { voucherId } = req.body;
      const now = Date.now();
      try {
        const voucherInfo = await voucherService.getVoucherInfoById(voucherId);
        if (!voucherInfo) {
          return res.send({ code: 1, message: 'Voucher không tồn tại' });
        }

        if (voucherInfo.payment !== 'free') {
          return res.send({ code: 1, message: 'Voucher không thể nhận' });
        }

        if (Number(voucherInfo.startDate) > now) {
          return res.send({
            code: 1,
            message: 'Voucher chưa đến thời gian nhận',
          });
        }

        if (Number(voucherInfo.endDate) < now) {
          return res.send({
            code: 1,
            message: 'Voucher đã hết hạn',
          });
        }

        const result = await voucherService.customerClaimVoucher(
          voucherInfo,
          customerId
        );
        return res.send({ code: 0, message: 'Thành công', data: result });
      } catch (error) {
        return res.send({ code: 1, message: 'Không thể nhận voucher' });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
