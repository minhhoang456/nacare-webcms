import voucherService from '@root/src/services/voucher.service';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/get-info`,
    schema: {
      tags: ['Voucher'],
      body: z.object({
        voucherId: z.number(),
      }),
      response: {},
    },
    handler: async (req, res) => {
      const { voucherId } = req.body;
      try {
        const now = Date.now();
        const voucherInfo = await voucherService.getVoucherInfoById(voucherId);
        if (!voucherInfo) {
          return res.send({
            code: 1,
            message: 'Không tìm thấy thông tin voucher',
          });
        }
        if (!voucherInfo.isActive || !voucherInfo.isApprove) {
          return res.send({
            code: 1,
            message: 'Voucher không thể nhận',
          });
        }
        if (voucherInfo.payment !== 'free') {
          return res.send({
            code: 1,
            message: 'Voucher không thể nhận',
          });
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

        return res.send(voucherInfo);
      } catch (error) {
        return res.send({
          code: 1,
          message: 'Không thể lấy thông tin voucher',
        });
      }
    },
  });
};
