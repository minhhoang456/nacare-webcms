import customerMiddleware from '@root/src/middleware/customer';
import codeService from '@root/src/services/code.service';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prismaClient } from '@root/src/utils/prisma';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/add-voucher-code`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ['Voucher'],
      body: z.object({
        code: z.string(),
      }),
      response: {},
    },
    handler: async (req, res) => {
      //@ts-ignore
      const customerId = req.customerId;
      const { code } = req.body;
      try {
        const codeInfo = await codeService.getCodeInfo(code);
        if (!codeInfo) {
          return res.send({ code: 1, message: 'Mã voucher không tồn tại' });
        }

        await prismaClient.code.update({
          where: { id: codeInfo.id },
          data: { customerId },
        });

        return res.send({ code: 0, message: 'Nhập mã thành công' });
      } catch (error) {
        return res.send({ code: 1, message: 'Lỗi hệ thống' });
      }
    },
  });
};



// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
