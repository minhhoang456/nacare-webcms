/* eslint-disable no-async-promise-executor */
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { customerService } from '@root/src/services';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/get-token`,
    // Define your schema
    schema: {
      tags: ['Customer'],
      summary: 'Khởi tạo phiên làm việc của khách hàng',
      description: 'Trả về đường dẫn webview và token của khách hàng',
      body: z.object({
        refId: z
          .string()
          .describe('Reference ID')
          .min(1, 'Ref ID không được để trống'),
        name: z.string().describe('Name').optional(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      const { refId, name } = req.body;
      try {
        const data = await new Promise(async (resolve, reject) => {
          const token = await customerService.syncCustomer(refId, name);
          if (!token) reject(new Error('sync_customer_failed'));
          resolve({
            token,
          });
        });

        return res.send({ code: 0, message: 'Thành công', data });
      } catch (error: any) {
        switch (error.code) {
          case 'sync_customer_failed': {
            return res.code(400).send({ code: 1, message: 'Thất bại' });
          }
        }
        return res.code(400).send({ code: 1, message: 'Thất bại' });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
