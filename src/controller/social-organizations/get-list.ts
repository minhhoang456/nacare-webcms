import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-list`,
    // Define your schema
    schema: {
      // body: z.object({
      // }),
      querystring: z.object({
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
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { skip, limit } = req.query;

        const [list, total] = await Promise.all([
          prismaClient.socialOrganizationsFeedbacks.findMany({
            skip,
            take: limit,
            orderBy: {
              createdAt: "desc",
            },
          }),
          prismaClient.socialOrganizationsFeedbacks.count(),
        ]);
        return res.status(200).send({ data: list, code: 0, message: "Lấy danh sách phản ánh thành công", total });
      } catch (error) {
        return res.status(500).send({ message: "Hệ thống đang bận vui lòng thử lại sau", code: -1 });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
