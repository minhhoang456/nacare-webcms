import customerMiddleware from '@root/src/middleware/customer';
import { TrackingActionType, trackingscService } from '@root/src/services';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/tracking`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      body: z.object({
        actionType: z
          .enum(Object.values(TrackingActionType) as [string, ...string[]])
          .describe('Action type'),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { actionType } = req.body;
        trackingscService.addTracking({
          actionType: actionType as TrackingActionType,
        });
        return res.send({ code: 0, message: 'success' });
      } catch (error) {
        return res.status(400).send({ code: 1, message: 'failed' });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
