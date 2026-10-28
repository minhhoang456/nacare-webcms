import userMidlleware from '@root/src/middleware/user';
import { prismaClient } from '@root/src/utils/prisma';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import actionLogMidlleware from '@root/src/middleware/actionLog';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-flashsale-info`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      summary: 'Flash Sale - Lấy thông tin flash sale',
      description: 'Lấy thông tin flash sale',
      // body: z.object({
      // }),
      querystring: z.object({
        flashSaleVoucherId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .describe('ID của chương trình khuyến mãi'),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { flashSaleVoucherId } = req.query;
        const flashSaleVoucherInfo =
          await prismaClient.flashSaleVoucher.findUnique({
            where: {
              id: flashSaleVoucherId,
            },
          });

        if (!flashSaleVoucherInfo) {
          return res.status(404).send({
            code: 1,
            message: 'Không tìm thấy chương trình khuyến mãi',
          });
        }
        const flashSaleVoucherDetails =
          await prismaClient.flashSaleVoucherDetail.findMany({
            where: {
              flashSaleVoucherId,
            },
            orderBy: { sequence: 'asc' },
          });
        const voucherInfos = await prismaClient.voucher.findMany({
          where: {
            id: {
              in: flashSaleVoucherDetails.map((detail) => detail.voucherId),
            },
          },
        });
        const flashSaleVoucherDetailsWithVoucherInfo =
          flashSaleVoucherDetails.map((detail) => {
            const voucherInfo = voucherInfos.find(
              (voucher) => voucher.id === detail.voucherId
            );
            return {
              ...detail,
              voucherInfo,
            };
          });
        const response = {
          ...flashSaleVoucherInfo,
          flashSaleVoucherDetails: flashSaleVoucherDetailsWithVoucherInfo,
        };
        return res.status(200).send({
          code: 0,
          message: 'Thành công',
          data: response,
        });
      } catch (err) {
        return res.status(500).send({
          code: 1,
          message: 'Có lỗi xảy ra',
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
