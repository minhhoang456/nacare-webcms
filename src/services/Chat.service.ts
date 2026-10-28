import { ObjectId } from "mongodb";
import {
  CONVERSATION_STATUS,
  IConversation,
  IMessage,
  MESSAGE_STATUS,
  SENDER_TYPE,
} from "../types/chat.type";
import client from "../utils/mongo";
import customerService from "./customer.service";
import storeService from "./store.service";

export const ChatService = {
  getInstanceChatConversation: () => {
    return client.db().collection<IConversation>("conversation");
  },
  getConversation: async ({
    userId,
    sellerId,
    skip,
    limit,
  }: {
    userId?: number;
    sellerId?: number;
    skip: number;
    limit: number;
  }) => {
    const conversation = ChatService.getInstanceChatConversation();
    const query: any = {};
    if (userId) {
      query.userId = userId;
    }
    if (sellerId) {
      query.sellerId = sellerId;
    }
    const [conversations, totalArray] = await Promise.all([
      conversation
        .aggregate([
          { $match: query },
          {
            $lookup: {
              from: "message",
              let: { conversationId: { $toString: "$_id" } },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$conversationId", "$$conversationId"] },
                    status: { $ne: MESSAGE_STATUS.READ },
                  },
                },
                {
                  $count: "unreadCount",
                },
              ],
              as: "unreadMessages",
            },
          },
          {
            $addFields: {
              unreadCount: {
                $ifNull: [
                  { $arrayElemAt: ["$unreadMessages.unreadCount", 0] },
                  0,
                ],
              },
            },
          },
          { $unset: "unreadMessages" },
          { $sort: { updatedAt: -1 } },
          { $skip: skip },
          { $limit: limit },
        ])
        .toArray(),
      conversation.countDocuments(query as any),
    ]);
    return {
      data: conversations,
      total: totalArray,
    };
  },

  getInstanceChatMessage: () => {
    return client.db("nacare-chat").collection<IMessage>("message");
  },

  getMessage: async ({
    conversationId,
    skip,
    limit,
  }: {
    conversationId: string;
    skip: number;
    limit: number;
  }) => {
    const message = ChatService.getInstanceChatMessage();
    const [messages, totalArray] = await Promise.all([
      message
        .aggregate([
          { $match: { conversationId } },
          { $sort: { timestamp: -1 } },
          { $skip: skip },
          { $limit: limit },
        ])
        .toArray(),
      message.countDocuments({ conversationId }),
    ]);
    return {
      data: messages,
      total: totalArray,
    };
  },

  createConversation: async ({
    userId,
    sellerId,
    userType,
  }: {
    userId: number;
    sellerId: number;
    userType: SENDER_TYPE;
  }) => {
    const conversation = ChatService.getInstanceChatConversation();
    const userInfo = await customerService.getCustomerInfo(userId);
    const sellerInfo = await storeService.getStoreInfoById(sellerId);
    if (!userInfo || !sellerInfo) {
      throw new Error("User or seller not found");
    }
    // Check if conversation already exists
    const existingConversation = await conversation.findOne({
      userId,
      sellerId,
    });
    if (existingConversation) {
      return existingConversation;
    }

    const conversationData = {
      userId,
      sellerId,
      userInfo: {
        id: userId,
        name: userInfo.name,
        avatar: userInfo.avatar,
      },
      sellerInfo: {
        id: sellerId,
        name: sellerInfo.name,
        avatar: sellerInfo.logo,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: CONVERSATION_STATUS.ACTIVE,
      userType,
    };

    const result = await conversation.insertOne(conversationData);

    return {
      _id: result.insertedId,
      ...conversationData,
    };
  },

  createMessage: async (messageData: IMessage) => {
    const message = ChatService.getInstanceChatMessage();
    const conversation = ChatService.getInstanceChatConversation();

    const data = {
      timestamp: Date.now(),
      status: MESSAGE_STATUS.SENT,
    };

    // Create message
    const newMessage = await message.insertOne({
      ...messageData,
      ...data,
    });

    // Update conversation
    await conversation.updateOne(
      { _id: new ObjectId(messageData.conversationId as string) },
      {
        $set: {
          lastMessage: {
            ...messageData,
            _id: newMessage.insertedId,
            ...data,
          },
          updatedAt: Date.now(),
        },
      },
    );

    return { ...messageData, _id: newMessage.insertedId, ...data };
  },

  markMessageAsRead: async (conversationId: string, messageId?: string) => {
    const message = ChatService.getInstanceChatMessage();
    const baseQuery = {
      conversationId,
      status: { $ne: MESSAGE_STATUS.READ },
    };
    if (messageId) {
      // Update single message
      await message.updateOne(
        {
          ...baseQuery,
          _id: new ObjectId(messageId),
        },
        {
          $set: { status: MESSAGE_STATUS.READ },
        },
      );
    } else {
      // Update all unread messages
      await message.updateMany(baseQuery, {
        $set: { status: MESSAGE_STATUS.READ },
      });
    }
  },

  checkConversationExists: async ({
    conversationId,
    userId,
    sellerId,
  }: {
    conversationId: string;
    userId?: number;
    sellerId?: number;
  }) => {
    const conversation = ChatService.getInstanceChatConversation();
    const query: any = { _id: new ObjectId(conversationId) };
    if (userId) {
      query.userId = userId;
    }
    if (sellerId) {
      query.sellerId = sellerId;
    }
    const result = await conversation.findOne(query);
    return result;
  },
};
export default ChatService;
