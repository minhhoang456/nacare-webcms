import customerMiddleware from "@root/src/middleware/customer";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import redis from "@root/src/utils/redis";
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-list-cart-by-customer`,
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ['Cart'],
      description: 'Lấy danh sách giỏ hàng của khách hàng',
      querystring: z.object({
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0).optional(),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0).optional(),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { skip, limit } = req.query;
        //@ts-ignore
        const customerId = req.customerId;
        const cart = await redis.get(`cart:${customerId}`);
        if (!cart) return res.status(200).send({
          code: 0,
          message: 'Success',
          data: [],
          total: 0,
        });
        let originalData = JSON.parse(cart);
        const transformedData = originalData.reduce((acc: any, curr: any) => {
          const { storeId } = curr;
          const store = acc.find((s: any) => s.storeId === storeId);
      
          if (store) {
              store.data.push(curr);
          } else {
              acc.push({ storeId: storeId, data: [curr] });
          }
      
          return acc;
        }, []);
        return res.status(200).send({
          code: 0,
          message: 'Success',
          data: (skip && limit) ? transformedData.slice(skip, limit) : transformedData,
          total: transformedData.length,
        });
      } catch (error) {
        return res.status(500).send(error);
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
