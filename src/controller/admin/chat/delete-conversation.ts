import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { ObjectId } from "mongodb";
import { ChatService } from "@src/services/Chat.service";
import { z } from "zod";
import userMidlleware from "@root/src/middleware/user";
import { SENDER_TYPE } from "@src/types/chat.type";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/delete-conversation`,
    preHandler: [userMidlleware as any],
    schema: {
      querystring: z.object({
        conversationId: z.string(),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      const { conversationId } = req.query;
      const { userId, roleSpecial } = req;

      try {
        // Check SHOP role
        if (roleSpecial !== 'SHOP') {
          return res.status(403).send({
            code: 3,
            message: "Only sellers (SHOP) can delete conversations",
          });
        }

        if (!ObjectId.isValid(conversationId)) {
          return res.status(400).send({
            code: 1,
            message: "Invalid conversation ID",
          });
        }

        // Get conversation info to check permissions
        const conversation = await ChatService.getInstanceChatConversation().findOne({
          _id: new ObjectId(conversationId),
          userId: userId
        });

        if (!conversation) {
          return res.status(404).send({
            code: 2,
            message: "Conversation not found",
          });
        }

        // Get last message to check userType
        const lastMessage = await ChatService.getInstanceChatMessage().findOne(
          { conversationId },
          { sort: { timestamp: -1 } }
        );

        if (!lastMessage || lastMessage.senderType !== SENDER_TYPE.SELLER) {
          return res.status(403).send({
            code: 3,
            message: "Can only delete conversation when the last message is from seller",
          });
        }

        // Delete conversation and messages
        await Promise.all([
          ChatService.getInstanceChatConversation().deleteOne({
            _id: new ObjectId(conversationId)
          }),
          ChatService.getInstanceChatMessage().deleteMany({
            conversationId
          })
        ]);

        return res.status(200).send({
          code: 0,
          message: "Conversation deleted successfully",
        });
      } catch (err) {
        console.error("Error deleting conversation:", err);
        return res.status(500).send({
          code: -1,
          message: "Server error",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
