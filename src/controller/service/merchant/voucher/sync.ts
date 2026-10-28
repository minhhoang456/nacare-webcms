import { prismaClient } from '@root/src/utils/prisma';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import exchange from '@root/src/utils/exchange';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/sync`,
    // Define your schema
    schema: {
      body: z.object({
        id: z.number(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { id } = req.body;
        const voucherInfo: any = await prismaClient.voucher.findUnique({
          where: {
            id: id,
          },
        });

        const { code, voucher_pool } =
          await exchange.syncUpsertVoucher(voucherInfo);
        if (code === 1) {
          return res.send({
            code: 1,
            message: 'Error sync voucher',
          });
        }
        if (voucher_pool?.voucher_id) {
          await prismaClient.voucher.update({
            where: {
              id: id,
            },
            data: {
              voucherId: voucher_pool.voucher_id,
            },
          });
        }

        return {
          code: 0,
          message: 'Success sync voucher',
        };
      } catch (err) {
        console.log(err);
        return {
          code: 1,
          message: 'Error sync voucher',
        };
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
