import userMidlleware from "@root/src/middleware/user";
import ChatService from "@root/src/services/Chat.service";
import { SENDER_TYPE } from "@root/src/types/chat.type";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/create-conversation`,
    preHandler: [userMidlleware as any],
    // Define your schema
    schema: {
      body: z.object({
        customerId: z.number().describe("ID của khach hang"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { customerId } = req.body;
        // @ts-ignore
        const storeId = req.storeId;
        const conversation = await ChatService.createConversation({
          userId: customerId,
          sellerId: storeId,
          userType: SENDER_TYPE.SELLER,
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
