import { Server, Socket } from "socket.io";
import { customerService } from "../services";
import { prismaClient } from "./prisma";

export interface NotificationData {
  customerId: number;
  title: string;
  content: string;
}

class SocketHandler {
  private static instance: SocketHandler;
  private io: Server;

  constructor(io: Server) {
    this.io = io;
    this.setupHandlers();
  }

  public static getInstance(io?: Server): SocketHandler {
    if (!SocketHandler.instance && io) {
      SocketHandler.instance = new SocketHandler(io);
    }
    return SocketHandler.instance;
  }

  private async handleCustomerSocket(
    customerId: number,
    socketId: string,
    isConnecting: boolean,
  ) {
    try {
      await customerService.updateCustomerInfo(Number(customerId), {
        socketId: isConnecting ? socketId : "",
      });
      console.log(
        `Socket ${customerId} ${isConnecting ? "connected" : "disconnected"}`,
      );
    } catch (error) {
      console.error(
        `Socket operation failed for customer ${customerId}:`,
        error,
      );
    }
  }

  setupHandlers() {
    this.io.on("connection", (socket: Socket) => {
      socket.on(
        "join",
        (customerId: number) =>
          customerId && this.handleCustomerSocket(customerId, socket.id, true),
      );

      socket.on("disconnect", async () => {
        const customer = await prismaClient.customer.findFirst({
          where: { socketId: socket.id },
          select: { id: true },
        });
        if (customer) {
          await this.handleCustomerSocket(customer.id, socket.id, false);
        }
      });
    });
  }

  async emitNotification({ customerId, title, content }: NotificationData) {
    try {
      const customer = await prismaClient.customer.findFirst({
        where: { id: customerId },
        select: { id: true, socketId: true },
      });
      if (customer?.socketId) {
        console.log(
          `emit_message ${customer.id}:${customer.socketId}:${JSON.stringify({ title, content })}`,
        );
        this.io.to(customer.socketId).emit("message", {
          sender: "Nacare-Server",
          title,
          message: content,
        });
      }
    } catch (error) {
      console.log(
        "🚀 ~ file: socket.ts:62 ~ SocketHandler ~ hasOtp ~ error:",
        error,
      );
    }
  }
}

export default SocketHandler;
