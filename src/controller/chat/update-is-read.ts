import { ChatService } from "@root/src/services/Chat.service";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import customerMiddleware from "@root/src/middleware/customer";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/update-is-read`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["chat"],
      description: "Cập nhật tin nhắn đã đọc",
      summary: "Cập nhật tin nhắn đã đọc",
      body: z.object({
        conversationId: z.string().describe("ID của cuộc trò chuyện"),
        messageId: z.string().optional().describe("ID của tin nhắn"),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { conversationId, messageId } = req.body;
        await ChatService.markMessageAsRead(
          conversationId,
          messageId ? messageId : undefined
        );
        return res.status(200).send({
          code: 0,
          message: "Cập nhật tin nhắn đã đọc thành công",
        });
      } catch (err) {
        return res.status(500).send({
          message: "Lỗi server",
          error: err,
        });
      }
    },
  });
};
