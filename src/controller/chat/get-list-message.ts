import customerMiddleware from "@root/src/middleware/customer";
import ChatService from "@root/src/services/Chat.service";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-list-message`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["chat"],
      description: "Lấy danh sách tin nhắn",
      summary: "Lấy danh sách tin nhắn",
      // body: z.object({
      // }),
      querystring: z.object({
        conversationId: z.string().describe("ID của cuộc hội thoại"),
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { conversationId, skip, limit } = req.query;
        // @ts-ignore
        const customerId = req.customerId;
        const conversationExists = await ChatService.checkConversationExists({
          conversationId: conversationId,
          userId: customerId,
        });
        if (!conversationExists) {
          return res.status(404).send({
            code: 1,
            message: "Cuộc hội thoại không tồn tại",
          });
        }
        const { data, total } = await ChatService.getMessage({
          conversationId: conversationId,
          skip,
          limit,
        });
        return res.status(200).send({
          code: 0,
          message: "Lấy danh sách tin nhắn thành công",
          data: data,
          total,
        });
      } catch (err) {
        console.log(err);
        return res.status(500).send({
          code: 1,
          message: "Đã có lỗi xảy ra, vui lòng thử lại sau",
          error: err,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
