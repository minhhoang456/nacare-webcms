import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import customerMiddleware from "@root/src/middleware/customer";
import referralClientService from "@src/services/referralClient.service";

const referralErrors: Record<string, { status: number; message: string }> = {
  "referrer customer not found": {
    status: 404,
    message: "Mã giới thiệu không tồn tại",
  },
  "a customer cannot refer themselves": {
    status: 422,
    message: "Bạn không thể tự giới thiệu chính mình",
  },
  "referral would create a cycle": {
    status: 422,
    message: "Quan hệ giới thiệu tạo thành vòng tròn",
  },
  "customer already has a referrer": {
    status: 409,
    message: "Bạn đã có người giới thiệu",
  },
};

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/apply",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Customer - Nhận mã giới thiệu từ QR",
      body: z.object({
        inviteCode: z.string().trim().min(1),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = Number(req.customerId);
      if (!Number.isSafeInteger(customerId) || customerId <= 0) {
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      }
      const inviteCode = String(req.body.inviteCode);
      try {
        const resp = await referralClientService.createReferral(
          inviteCode,
          customerId,
        );
        if (resp.code !== 0) {
          return res.code(200).send({
            code: 1,
            message: resp.message || "Đã có lỗi xảy ra, vui lòng thử lại sau",
          });
        }
        return res.send({
          code: 0,
          message: "Ghi nhận người giới thiệu thành công",
          data: resp.data,
        });
      } catch (error: any) {
        const errorMessage = String(error?.message || error);
        const mapped = referralErrors[errorMessage];
        if (mapped) {
          return res
            .code(mapped.status)
            .send({ code: 1, message: mapped.message });
        }
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Đã có lỗi xảy ra, vui lòng thử lại sau",
        });
      }
    },
  });
};
