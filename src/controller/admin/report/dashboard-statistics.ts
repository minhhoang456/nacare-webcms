import { summaryService } from "@root/src/services";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/dashboard-statistics`,
    schema: {
      response: {}
    },
    handler: async (_req, _res) => {
      try {
        const stats = await summaryService.getSummary();
        return stats;
      } catch (error) {
        console.log(`Lỗi lấy dashboard stats: ${error}`);
        return {
          totalSellers: 0,
          newSellers: 0,
          totalProducts: 0,
          newProducts: 0,
          totalOrders: { total: 0, completed: 0, canceled: 0 },
          totalTransactionValue: 0,
        };
      }
    },
  });
};
