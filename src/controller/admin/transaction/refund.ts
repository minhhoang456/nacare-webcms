import ono from '@jsdevtools/ono';
import actionLogMidlleware from '@root/src/middleware/actionLog';
import userMidlleware from '@root/src/middleware/user';
import { paymentTransactionService } from '@root/src/services';
import { prismaClient } from '@root/src/utils/prisma';
import pageMiddleware from '@src/middleware/page';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
const errors: Record<string, MessageError> = {
  default: { code: 1, message: 'Lỗi không xác định' },
  payment_not_found: { code: 1, message: 'Giao dịch không tồn tại' },
  payment_can_not_refund: { code: 2, message: 'Giao dịch không thể refund' },
  e_max_retry: { code: 3, message: 'Giao dịch đã thực hiện quá số lần retry' },
};

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/refund`,
    // Define your schema
    preHandler: [userMidlleware as any, pageMiddleware, actionLogMidlleware],
    schema: {
      body: z.object({
        id: z.number(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { id } = req.body;
        const paymentInfo = await prismaClient.paymentTransaction.findFirst({
          where: { id },
        });
        if (!paymentInfo) throw ono('payment_not_found');
        const refundResult =
          await paymentTransactionService.refundSuccessfulPayment(
            paymentInfo,
            'Hoàn tiền theo yêu cầu quản trị viên'
          );
        if (!refundResult?.isRefundSuccess) {
          throw ono('payment_can_not_refund');
        }
        return res.send({
          code: 0,
          message: refundResult.message,
        });
      } catch (error: any) {
        if (errors[error.message]) {
          return res.code(400).send(errors[error.message]);
        }
        return res.code(400).send(errors.default);
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
