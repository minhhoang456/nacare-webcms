import actionLogMidlleware from '@root/src/middleware/actionLog';
import userMidlleware from '@root/src/middleware/user';
import { geocodingService } from '@root/src/services';
import common from '@root/src/utils/common';
import redis from '@root/src/utils/redis';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/search`,
    // Define your schema
    preHandler: [userMidlleware as any, actionLogMidlleware],
    schema: {
      // body: z.object({
      // }),
      querystring: z.object({
        place: z.string().describe('Place'),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const key = common.removeAccentsAndSpaces(req.query.place, 'lowercase');
        let rs: any = await redis.get(key);
        if (rs) {
          return res.send(JSON.parse(rs));
        } else {
          rs = await geocodingService.getLatLongFromAddress(req.query.place);
          await redis.set(key, JSON.stringify(rs), 'EX', 60 * 60 * 24);
        }
        return res.send(rs);
      } catch (error) {
        return res.send([]);
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
