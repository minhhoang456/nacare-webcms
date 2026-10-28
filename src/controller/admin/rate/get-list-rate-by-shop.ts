import userMidlleware from "@root/src/middleware/user";
import { rateService } from "@root/src/services";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import pageMiddleware from "@src/middleware/page";
import actionLogMidlleware from "@root/src/middleware/actionLog";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-list-rate-by-shop`,
    preHandler: [userMidlleware as any, pageMiddleware, actionLogMidlleware],
    schema: {
      querystring: z.object({
        page: z.any().optional(),
        api: z.string().optional(),
        queryInput: z.string().optional().describe("Điều kiện lọc"),
        skip: z.any().optional(),
        limit: z.any().optional(),
        where: z.any().optional(),
        search: z.any().optional(),
        sort: z.any().optional(),
        select: z.any().optional(),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { skip = 0, limit = 10, sort = '[{ "createdAt": "desc" }]', where, search, queryInput } = req.query;
        const { storeId } = req;

        // Xử lý queryInput nếu có
        let queryInputParse: any = {};
        if (queryInput && typeof queryInput === 'string') {
          const parsedQuery: any = JSON.parse(queryInput);

          if (parsedQuery.star && parsedQuery.star !== 'all') {
            queryInputParse.star = parseInt(parsedQuery.star, 10);
          }

          if (parsedQuery.orderId) {
            queryInputParse.orderId = parsedQuery.orderId;
          }

          if (parsedQuery.name) {
            queryInputParse.name = {
              contains: parsedQuery.name,
              mode: 'insensitive'
            };
          }

          if (parsedQuery.productName) {
            queryInputParse.productInfo = {
              name: {
                contains: parsedQuery.productName,
                mode: 'insensitive'
              }
            };
          }

          if (parsedQuery.createdAt) {
            queryInputParse.createdAt = {};

            if (parsedQuery.createdAt.gte) {
              queryInputParse.createdAt.gte = parsedQuery.createdAt.gte;
            }

            if (parsedQuery.createdAt.lte) {
              queryInputParse.createdAt.lte = parsedQuery.createdAt.lte;
            }
          }
        }

        const query = {
          storeId,
          ...JSON.parse(where || "{}"),
          ...queryInputParse,
          ...(search ? JSON.parse(search) : undefined),
        };

        const rates = await rateService.getListRateByShop(
          query,
          Number(skip),
          Number(limit),
          sort
        );

        return res.status(200).send(rates);
      } catch (error) {
        console.error('Error in get-list-rate-by-shop:', error);
        return res.status(500).send(error);
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
