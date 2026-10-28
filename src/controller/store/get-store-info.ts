import customerOrNotMiddleware from "@root/src/middleware/customerOrNot";
import storeService from "@root/src/services/store.service";
import redis from "@root/src/utils/redis";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-store-info`,
    preHandler: [customerOrNotMiddleware as any],
    // Define your schema
    schema: {
      tags: ["store"],
      summary: "Get store info",
      description: "Get store info",
      // body: z.object({
      // }),
      querystring: z.object({
        storeId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
      }),
      response: {},
    },
    handler: async (req : any, res) => {
      try {
        const { storeId } = req.query;
        const customerId = req.customerId;
        const [data, isFollow] = await Promise.all([
          storeService.getStoreInfoById(storeId),
          customerId && await redis.sismember(`follow_store_customerId_${customerId}`, storeId),
        ]);
        return res.send({
          code: 0,
          message: "success",
          data: {
            ...data,
            isFollow: !!isFollow,
          },
        });
      } catch (error) {
        return res.status(500).send({
          code: 1,
          message: "Lỗi server",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
