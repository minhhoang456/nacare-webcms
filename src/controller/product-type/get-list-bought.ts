import productHelper from '@root/src/helpers/product.helper';
import customerMiddleware from '@root/src/middleware/customer';
import { prismaClient } from '@root/src/utils/prisma';
import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/get-list-bought`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      body: z.object({
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .default(0),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .default(10),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { customerId } = req;
        const { skip, limit } = req.body;
        const rsItems: any =
          await prismaClient.$queryRaw`select orderitem.typeId from ordership inner join orderitem on ordership.orderId = orderitem.orderId where ordership.customerId = ${customerId} group by orderitem.typeId`;
        if (rsItems) {
          const ids = rsItems.map((item: any) => item.typeId);
          if (ids) {
            const rs = await productHelper.getListProductType({
              query: { ids, skip, limit },
            });
            res.send({
              code: 0,
              message: 'success',
              data: rs.data,
              total: rs.total,
            });
          }
          res.send({
            code: 0,
            message: 'success',
            data: [],
            total: 0,
          });
        }
      } catch (error: any) {
        res
          .code(400)
          .send({ code: 1, message: error.message, data: [], total: 0 });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
