import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/feedbacks`,
    // Define your schema
    schema: {
      body: z.object({
        organizationName: z.string(),
        establishmentNumber: z.string(),
        content: z.string(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { organizationName, establishmentNumber, content } = req.body;
        const checkFeedback = await prismaClient.socialOrganizationsFeedbacks.findFirst({
          where: {
            establishmentNumber,
          },
        });
        if (checkFeedback) {
          return res.status(400).send({ message: "Đã có phản ánh từ tổ chức này", code: 0 });
        }
        await prismaClient.socialOrganizationsFeedbacks.create({
          data: { organizationName, establishmentNumber, content },
        });
        return res.status(200).send({ message: "Phản ánh của bạn đã được ghi nhận", code: 0 });
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
