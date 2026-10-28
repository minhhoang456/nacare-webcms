import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/gpdeliver`,
    // Define your schema
    schema: {
      body: z.object({
        request_id: z.string(),
        campaign_id: z.number(),
        message_id: z.string(),
        delivery_channel: z.string(),
        delivery_status: z.number(),
        delivery_description: z.string(),
        timestamp: z.string(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      const inputs: any = req.body;
      try {
        console.log('🚀 ~ file: gpdeliver.ts:33 ~ handler: ~ inputs:', inputs);
        return res.send({
          status: 200,
          description: 'delivery notification received',
          request_id: inputs.request_id,
        });
      } catch (error) {
        return res.code(401).send({
          status: 401,
          description: 'invalid signature',
          request_id: inputs.request_id,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
