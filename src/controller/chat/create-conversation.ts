import customerMiddleware from "@root/src/middleware/customer";
import ChatService from "@root/src/services/Chat.service";
import { SENDER_TYPE } from "@root/src/types/chat.type";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/create-conversation`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["chat"],
      description: "Tạo cuộc hội thoại",
      summary: "Tạo cuộc hội thoại",
      body: z.object({
        storeId: z.number().describe("ID của cửa hàng"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { storeId } = req.body;
        // @ts-ignore
        const customerId = req.customerId;
        const conversation = await ChatService.createConversation({
          userId: customerId,
          sellerId: storeId,
          userType: SENDER_TYPE.USER,
        });
        return res.status(200).send({
          code: 0,
          message: "Tạo cuộc hội thoại thành công",
          data: conversation,
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
