import customerMiddleware from "@root/src/middleware/customer";
import { notificationService } from "@root/src/services";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
// import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-noti-count`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ['notification'],
      summary: 'Get notification count',
      description: 'Get notification count',
      // body: z.object({
      // }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const customerId = req.customerId;
        const count = await notificationService.getNotiCount(customerId);
        return res.send({
          code: 0,
          message: 'Thành công',
          data: count,
        });
      } catch (error) {
        console.log(error);
        return res.send({
          code: -1,
          message: 'Hệ thống bận, vui lòng thử lại sau.',
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
