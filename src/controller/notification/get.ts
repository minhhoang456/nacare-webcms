import customerMiddleware from '@root/src/middleware/customer';
import { notificationService } from '@root/src/services';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ['notification'],
      // body: z.object({
      // }),
      querystring: z.object({
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const customerId = req.customerId;
        const { skip, limit } = req.query;
        const notifications = await notificationService.getNotifications(
          customerId,
          skip,
          limit
        );
        return res.send({
          code: 0,
          message: 'Success',
          data: notifications,
          total: notifications.length,
        });
      } catch (error) {
        console.log(error);
        return res.send({
          code: 1,
          message: 'Hệ thống bận, vui lòng thử lại sau ít phút',
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
