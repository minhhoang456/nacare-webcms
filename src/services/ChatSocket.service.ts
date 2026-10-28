import { Server, Socket } from "socket.io";
import { SENDER_TYPE, SOCKET_EVENTS } from "../types/chat.type";
import { ChatService } from "./Chat.service";
import { IMessage } from "../types/chat.type";
import { ObjectId } from "mongodb";
import customerService from "./customer.service";
import redis from "../utils/redis";
import { UserPresenceStatus, UserPresence } from "../types/presence.type";
import { ITypingStatus } from "../types/chat.type";

interface AuthenticatedSocket extends Socket {
  userId?: number;
  userType?: SENDER_TYPE;
  storeId?: number;
}

export class ChatSocketService {
  private static instance: ChatSocketService;
  private io: Server;
  private redis: typeof redis;
  private static readonly AWAY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private static readonly OFFLINE_TIMEOUT = 60 * 60 * 1000; // 1 hour
  private static readonly ACTIVE_ROOMS_KEY = "active_rooms";

  constructor(io: Server) {
    this.io = io;
    this.redis = redis;
    this.setupAuthMiddleware();
    this.setupEventHandlers();
  }

  public static getInstance(io?: Server): ChatSocketService {
    if (!ChatSocketService.instance && io) {
      ChatSocketService.instance = new ChatSocketService(io);
    }
    return ChatSocketService.instance;
  }

  private setupAuthMiddleware() {
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token =
          socket.handshake.auth.token ||
          socket.handshake.headers["authorization"];

        if (!token) {
          return next(new Error("Authentication token required"));
        }
        // Verify JWT token
        const decoded = customerService.verifyTokenChat(token);
        socket.userId = decoded.typeId;
        socket.userType = decoded.type;
        socket.storeId = decoded.storeId;
        next();
      } catch (error) {
        next(new Error("Invalid token"));
      }
    });
  }

  private setupEventHandlers() {
    this.io.on("connection", (socket: AuthenticatedSocket) => {
      this.handleConnection(socket);
    });
  }

  private getRoomId(conversationId: string | ObjectId) {
    return `conversation:${conversationId}`;
  }

  private handleConnection(socket: AuthenticatedSocket) {
    // Rate limiting setup
    const messageRateLimit = new Map<string, number>();
    const MAX_MESSAGES = 10;
    const TIME_WINDOW = 10000; // 10 seconds

    socket.on(SOCKET_EVENTS.JOIN_ROOM, async (conversationId: string) => {
      try {
        await this.joinRoom(socket, conversationId);
      } catch (error) {
        socket.emit(SOCKET_EVENTS.ERROR, {
          message: "Access denied to conversation",
        });
      }
    });

    socket.on(SOCKET_EVENTS.NEW_MESSAGE, async (data: IMessage) => {
      try {
        // Rate limiting check
        const userId = socket.userId!;
        const userMessages = messageRateLimit.get(userId.toString()) || 0;

        if (userMessages > MAX_MESSAGES) {
          socket.emit(SOCKET_EVENTS.ERROR, { message: "Rate limit exceeded" });
          return;
        }
        messageRateLimit.set(userId.toString(), userMessages + 1);
        setTimeout(
          () => messageRateLimit.set(userId.toString(), 0),
          TIME_WINDOW
        );

        // Validate message content
        if (!this.validateMessage(data)) {
          socket.emit("error", { message: "Invalid message format" });
          return;
        }

        // Ensure sender is authentic
        if (data.senderId !== userId || data.senderType !== socket.userType) {
          socket.emit("error", { message: "Unauthorized message sender" });
          return;
        }
        const message = await ChatService.createMessage({
          ...data,
          senderId: userId,
          senderType: socket.userType!,
        });

        const roomId = this.getRoomId(data.conversationId as string);
        this.io.to(roomId).emit(SOCKET_EVENTS.NEW_MESSAGE, message);

        const conversation = await ChatService.checkConversationExists({
          conversationId: data.conversationId as string,
        });

        if (conversation) {
          this.io.emit(SOCKET_EVENTS.NEW_CONVERSATION_MESSAGE, {
            message,
            conversation: {
              _id: conversation._id,
              userId: conversation.userId,
              sellerId: conversation.sellerId,
              lastMessage: message,
              updatedAt: Date.now(),
              name: conversation.userInfo?.name,
              avatar: conversation.userInfo?.avatar,
            }
          });
        }
      } catch (error) {
        console.log(error,'err send message socket line 122 in chat.socket.service')
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // xử lý sự kiện typing
    socket.on(SOCKET_EVENTS.TYPING_START, (data: ITypingStatus) => {
      try {
        const roomId = this.getRoomId(data.conversationId);
        // Broadcast đến tất cả client khác trong room
        socket.to(roomId).emit(SOCKET_EVENTS.TYPING_START, {
          userId: socket.userId,
          userType: socket.userType,
          conversationId: data.conversationId
        });
      } catch (error) {
        console.error('Error handling typing start:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: "Failed emit typing start" });
      }
    });

    socket.on(SOCKET_EVENTS.TYPING_END, (data: ITypingStatus) => {
      try {
        const roomId = this.getRoomId(data.conversationId);
        socket.to(roomId).emit(SOCKET_EVENTS.TYPING_END, {
          userId: socket.userId,
          userType: socket.userType,
          conversationId: data.conversationId
        });
      } catch (error) {
        console.error('Error handling typing end:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: "Failed emit typing end" });
      }
    });

    // xử lý sự kiện focus/blur
    socket.on(SOCKET_EVENTS.FOCUS, (conversationId: string) => {
      try {
        const roomId = this.getRoomId(conversationId);
        socket.to(roomId).emit(SOCKET_EVENTS.FOCUS, {
          userId: socket.userId,
          userType: socket.userType,
          conversationId
        });
      } catch (error) {
        console.error('Error handling focus:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: "Failed emit focus" });
      }
    });

    socket.on(SOCKET_EVENTS.BLUR, (conversationId: string) => {
      try {
        const roomId = this.getRoomId(conversationId);
        socket.to(roomId).emit(SOCKET_EVENTS.BLUR, {
          userId: socket.userId,
          userType: socket.userType,
          conversationId
        });
      } catch (error) {
        console.error('Error handling blur:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: "Failed emit blur" });
      }
    });

    this.setupPresenceHandlers(socket);
  }

  private async verifyConversationAccess(
    userId: number,
    conversationId: string,
    userType: SENDER_TYPE,
    storeId?: number
  ): Promise<boolean> {
    const conversation =
      await ChatService.getInstanceChatConversation().findOne({
        _id: new ObjectId(conversationId),
        $or: [
          { userId },
          { sellerId: storeId },
          { sellerId: userType === SENDER_TYPE.SELLER ? storeId : 0 },
        ],
      });

    if (!conversation) {
      throw new Error("Unauthorized access to conversation");
    }
    return true;
  }

  private validateMessage(message: IMessage): boolean {
    // Basic message validation
    if (!message.content && !message.attachments?.length) {
      return false;
    }

    // Content length limits
    if (message.content && message.content.length > 1000) {
      return false;
    }

    // Attachment validation
    if (message.attachments) {
      const validExtensions = [".jpg", ".png", ".gif", ".pdf"];
      const validAttachments = message.attachments.every((att) =>
        validExtensions.some((ext) => att.toLowerCase().endsWith(ext))
      );
      if (!validAttachments) return false;
    }

    return true;
  }

  // Helper method to get presence key
  private getPresenceKey(userId: number, userType: SENDER_TYPE): string {
    return `presence:${userType}:${userId}`;
  }

  private async updatePresence(socket: AuthenticatedSocket) {
    const userId = socket.userId!;
    const userType = socket.userType!;
    const now = Date.now();

    const presenceKey = this.getPresenceKey(userId, userType);

    // Update last active timestamp in Redis
    await this.redis.hset(presenceKey, {
      lastActive: now,
      status: UserPresenceStatus.ONLINE,
      userType: userType,
    });

    // Update device count
    const deviceCount = await this.getDeviceCount(userId, userType);
    await this.redis.hset(presenceKey, "deviceCount", deviceCount);
  }

  private async getUserPresence(
    userId: number,
    userType: SENDER_TYPE
  ): Promise<UserPresence | null> {
    const presenceKey = this.getPresenceKey(userId, userType);
    const presenceData = await this.redis.hgetall(presenceKey);
    if (!presenceData) return null;

    const lastActive = parseInt(presenceData.lastActive);
    const now = Date.now();
    const timeSinceActive = now - lastActive;

    let status: UserPresenceStatus;
    if (timeSinceActive < ChatSocketService.AWAY_TIMEOUT) {
      status = UserPresenceStatus.ONLINE;
    } else if (timeSinceActive < ChatSocketService.OFFLINE_TIMEOUT) {
      status = UserPresenceStatus.AWAY;
    } else {
      status = UserPresenceStatus.OFFLINE;
    }

    return {
      userId,
      userType,
      status,
      lastActive,
      deviceCount: parseInt(presenceData.deviceCount) || 0,
    };
  }

  private setupPresenceHandlers(socket: AuthenticatedSocket) {
    // Update presence on connection
    this.updatePresence(socket);

    // Set up interval to update presence periodically
    const presenceInterval = setInterval(() => {
      this.updatePresence(socket);
    }, 5 * 60000); // Update 5 minute

    // Clean up on disconnect
    socket.on(SOCKET_EVENTS.DISCONNECT, async () => {
      clearInterval(presenceInterval);
      await this.handleDisconnect(socket);
    });

    // Handle manual status updates
    socket.on(
      SOCKET_EVENTS.UPDATE_STATUS,
      async (status: UserPresenceStatus) => {
        await this.redis.hset(`presence:${socket.userId}`, "status", status);
        await this.broadcastPresenceUpdate(socket.userId!, socket.userType!);
      }
    );
  }

  private async handleDisconnect(socket: AuthenticatedSocket) {
    const userId = socket.userId!;
    const userType = socket.userType!;
    const rooms = await this.redis.smembers(ChatSocketService.ACTIVE_ROOMS_KEY);

    for (const roomId of rooms) {
      await this.redis.srem(
        roomId,
        JSON.stringify({
          userId,
          userType,
          socketId: socket.id,
        })
      );
      await this.cleanupRoom(roomId);
    }

    const deviceCount = await this.getDeviceCount(userId, userType);
    if (deviceCount === 0) {
      const presenceKey = this.getPresenceKey(userId, userType);
      await this.redis.hset(presenceKey, {
        status: UserPresenceStatus.OFFLINE,
        lastActive: Date.now(),
      });
    }

    await this.broadcastPresenceUpdate(userId, userType);
  }

  private async getDeviceCount(
    userId: number,
    userType: SENDER_TYPE
  ): Promise<number> {
    let count = 0;
    const rooms = await this.redis.smembers(ChatSocketService.ACTIVE_ROOMS_KEY);

    for (const roomId of rooms) {
      const members = await this.redis.smembers(roomId);
      count += members.filter((member) => {
        const parsed = JSON.parse(member);
        return parsed.userId === userId && parsed.userType === userType;
      }).length;
    }

    return count;
  }

  public async getFormattedPresence(
    userId: number,
    userType: SENDER_TYPE
  ): Promise<string> {
    const presence = await this.getUserPresence(userId, userType);
    if (!presence) return "Offline";

    const now = Date.now();
    const timeDiff = now - presence.lastActive;

    if (presence.status === UserPresenceStatus.ONLINE) {
      return "Online";
    }

    if (timeDiff < 5 * 60 * 1000) {
      // 5 minutes
      return "Just now";
    } else if (timeDiff < 60 * 60 * 1000) {
      // 1 hour
      return `${Math.floor(timeDiff / (60 * 1000))} minutes ago`;
    } else if (timeDiff < 24 * 60 * 60 * 1000) {
      // 1 day
      return `${Math.floor(timeDiff / (60 * 60 * 1000))} hours ago`;
    } else {
      return new Date(presence.lastActive).toLocaleDateString();
    }
  }

  private async broadcastPresenceUpdate(userId: number, userType: SENDER_TYPE) {
    const presence = await this.getUserPresence(userId, userType);
    const rooms = await this.redis.smembers(ChatSocketService.ACTIVE_ROOMS_KEY);

    for (const roomId of rooms) {
      const members = await this.redis.smembers(roomId);
      const isUserInRoom = members.some((member) => {
        const parsed = JSON.parse(member);
        return parsed.userId === userId && parsed.userType === userType;
      });

      if (isUserInRoom) {
        this.io.to(roomId).emit(SOCKET_EVENTS.PRESENCE_UPDATE, presence);
      }
    }
  }

  // When joining a room, add to active rooms set
  private async joinRoom(socket: AuthenticatedSocket, conversationId: string) {
    try {
      await this.verifyConversationAccess(
        socket.userId!,
        conversationId,
        socket.userType!,
        socket.storeId
      );
      const roomId = this.getRoomId(conversationId);

      await this.redis.sadd(ChatSocketService.ACTIVE_ROOMS_KEY, roomId);

      await this.redis.sadd(
        `room:${roomId}`,
        JSON.stringify({
          userId: socket.userId,
          userType: socket.userType,
          socketId: socket.id,
        })
      );

      socket.join(roomId);
    } catch (error) {
      socket.emit(SOCKET_EVENTS.ERROR, {
        message: "Access denied to conversation",
      });
    }
  }

  // Clean up empty rooms
  private async cleanupRoom(roomId: string) {
    const members = await this.redis.smembers(`room:${roomId}`);
    if (members.length === 0) {
      await this.redis.del(`room:${roomId}`);
      await this.redis.srem(ChatSocketService.ACTIVE_ROOMS_KEY, roomId);
    }
  }
}
