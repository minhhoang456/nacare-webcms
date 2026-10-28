import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@src/utils/prisma";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/info",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Customer - Xem trước thông tin người giới thiệu",
      description:
        "Dùng sau khi quét QR. Chỉ khi customer xác nhận mới gọi API apply.",
      querystring: z.object({
        inviteCode: z.string().trim().min(1),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = Number(req.customerId);
      if (!Number.isSafeInteger(customerId) || customerId <= 0) {
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      }
      const inviteCode = String(req.query.inviteCode);
      try {
        const referrer = await prismaClient.customer.findUnique({
          where: { inviteCode: inviteCode },
          select: {
            id: true,
            name: true,
            phone: true,
            avatar: true,
            isBlock: true,
          },
        });
        if (!referrer || referrer.isBlock) {
          return res.code(404).send({
            code: 1,
            message: "Mã giới thiệu không tồn tại",
          });
        }
        if (referrer.id === customerId) {
          return res.code(422).send({
            code: 1,
            message: "Bạn không thể tự giới thiệu chính mình",
          });
        }
        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            id: referrer.id,
            name: referrer.name,
            phone: referrer.phone,
            avatar: referrer.avatar,
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể lấy thông tin người giới thiệu lúc này",
        });
      }
    },
  });
};
