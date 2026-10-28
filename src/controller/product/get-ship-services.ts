import customerMiddleware from '@root/src/middleware/customer';
import ShipManager from '@root/src/utils/shipManager';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-ship-services`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ['Product-Order'],
      // body: z.object({
      // }),
      querystring: z.object({
        senderAddress: z.string().describe('Địa chỉ người gửi'),
        receiverAddress: z.string().describe('Địa chỉ người nhận'),
        productWeight: z
          .string()
          .transform((val) => Number(val))
          .describe('Khối lượng sản phẩm (Gram)'),
        productPrice: z
          .string()
          .transform((val) => Number(val))
          .describe('Giá trị sản phẩm (VND)'),
        moneyCollection: z
          .string()
          .transform((val) => Number(val))
          .describe('Số tiền thu hộ (VND)'),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const {
          senderAddress,
          receiverAddress,
          productWeight,
          productPrice,
          moneyCollection,
        } = req.query;
        const shipServices = await ShipManager.getInstance().getServices({
          senderAddress: senderAddress,
          receiverAddress: receiverAddress,
          productWeight: Number(productWeight),
          productPrice: Number(productPrice),
          moneyCollection: moneyCollection ? `${moneyCollection}` : '0',
        });
        res.send({ code: 0, message: 'Thành công', data: shipServices });
      } catch (error) {
        res.status(500).send({
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
