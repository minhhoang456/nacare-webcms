import { ChatService } from "@root/src/services/Chat.service";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMidlleware from "@root/src/middleware/user";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/update-is-read`,
    preHandler: [userMidlleware as any],
    // Define your schema
    schema: {
      body: z.object({
        conversationId: z.string(),
        messageId: z.string().optional(),
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
