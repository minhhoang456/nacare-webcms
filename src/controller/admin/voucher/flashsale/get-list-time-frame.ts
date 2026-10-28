import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
// import { z } from "zod";
import { prismaClient } from '@root/src/utils/prisma';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-list-time-frame`,
    // Define your schema
    schema: {
      summary: 'Flash Sale - Lấy danh sách time frame',
      description: 'Lấy danh sách time frame flash sale',
      // body: z.object({
      // }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (_req, res) => {
      try {
        const timeFrames = await prismaClient.timeFrameFlashSale.findMany({
          where: {
            isActive: true,
          },
          orderBy: {
            startHour: 'asc',
          },
        });
        return res.send({
          code: 0,
          message: 'Thành công',
          data: timeFrames,
        });
      } catch (err) {
        return res.status(500).send({
          code: 1,
          message: 'Đã có lỗi xảy ra',
          err,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
