import { prismaClient } from '@root/src/utils/prisma';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Prisma } from '@src/utils/prisma';
import userMidlleware from '@root/src/middleware/user';
import actionLogMidlleware from '@root/src/middleware/actionLog';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-list-flashsale-config`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      summary: 'Flash Sale - Lấy danh sách chương trình khuyến mãi',
      description: 'Lấy danh sách chương trình khuyến mãi',
      // body: z.object({
      // }),
      querystring: z.object({
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .describe('Số lượng bỏ qua'),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .describe('Số lượng lấy'),
        name: z.string().optional().describe('Tên chương trình khuyến mãi'),
        isActive: z
          .boolean()
          .optional()
          .describe('Trạng thái chương trình khuyến mãi'),
        startTime: z
          .union([z.number(), z.string().regex(/\d+/).transform(Number)])
          .refine((n) => n >= 1)
          .optional()
          .describe('Thời gian bắt đầu'),
        endTime: z
          .union([z.number(), z.string().regex(/\d+/).transform(Number)])
          .refine((n) => n >= 1)
          .optional()
          .describe('Thời gian kết thúc'),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { skip, limit, name, isActive, startTime, endTime } = req.query;
        const where: Prisma.FlashSaleVoucherWhereInput = {};
        if (name) {
          where.name = { contains: name };
        }
        if (isActive !== undefined) {
          where.isActive = isActive;
        }
        if (startTime) {
          where.startTime = { gte: startTime };
        }
        if (endTime) {
          where.endTime = { lte: endTime };
        }
        const [flashSaleVouchers, total] = await prismaClient.$transaction([
          prismaClient.flashSaleVoucher.findMany({
            where,
            skip: skip || 0,
            take: limit || 10,
          }),
          prismaClient.flashSaleVoucher.count({ where }),
        ]);
        return res.send({
          code: 0,
          message: 'Thành công',
          data: flashSaleVouchers,
          count: total,
        });
      } catch (err) {
        return res.status(500).send({
          code: 1,
          message: 'Lỗi hệ thống',
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
