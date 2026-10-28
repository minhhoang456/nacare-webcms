import integrationMiddleware from '@root/src/middleware/integration';
import voucherService from '@root/src/services/voucher.service';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/integration-claim`,
    preHandler: [integrationMiddleware as any],
    schema: {
      body: z.object({
        voucherId: z.number(),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      const now = Date.now();
      try {
        const { integrationId, integrationName } = req;
        const { voucherId } = req.body;
        const voucherInfo = await voucherService.getVoucherInfoById(voucherId);
        if (!voucherInfo) {
          return res.send({ code: 1, message: 'Voucher không tồn tại' });
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
        const { success, message, codeId, code, expiredAt } =
          await voucherService.integrationClaimVoucher(
            voucherInfo,
            integrationId,
            integrationName
          );
        if (success && codeId && code) {
          return res.send({
            code: 0,
            message: message || 'success',
            data: { codeId, code, expiredAt },
          });
        }
        return res.code(500).send({
          code: 1,
          message: message || 'failed',
        });
      } catch (error) {
        return res.code(500).send({
          code: 1,
          message: 'failed',
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
