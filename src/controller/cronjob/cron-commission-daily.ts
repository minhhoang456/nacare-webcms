import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import Conf from '@src/services/conf';
import { commissionRunService } from '@src/services';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: '/cron-commission-daily',
    schema: {
      tags: ['Cronjob'],
      summary: 'Quyết toán Tiêu dùng tích sản (Mục 2) cho một ngày',
      querystring: z.object({
        auth: z.string().min(1),
      }),
      body: z.object({
        calculationDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
      response: {},
    },
    handler: async (req, res) => {
      if (
        req.query.auth !==
        Conf.get('TECT_SECRET', 'a565d01e-3dd4-4464-b8e2-9d49e3a460d')
      ) {
        return res.code(403).send({ code: 2, message: 'Unauthorized' });
      }
      try {
        const result = await commissionRunService.runDaily(
          req.body.calculationDate
        );
        return res.send({ code: 0, message: 'Thành công', data: result });
      } catch (error: any) {
        return res.code(500).send({
          code: 1,
          message: String(error?.message || error),
        });
      }
    },
  });
};
