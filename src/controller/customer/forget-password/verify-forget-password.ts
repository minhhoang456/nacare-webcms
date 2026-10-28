import customerService from "@root/src/services/customer.service";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/verify-forget-password`,
    schema: {
      tags: ["Customer"],
      summary: "Customer - Xác thực OTP đặt lại mật khẩu",
      description: "Customer - Xác thực OTP đặt lại mật khẩu",
      body: z.object({
        emailOrPhone: z.string(),
        otp: z.string(),
        keyPrivate: z.string(),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      const { emailOrPhone, otp, keyPrivate } = req.body;
      try {
        await customerService.processOtpVerification({
          emailOrPhone: emailOrPhone,
          typeVerify: "forget_password",
          keyPrivate,
          otp,
        });
        return res.status(200).send({
          code: 0,
          message: `success`,
        });
      } catch (error: any) {
        console.log("🚀 ~ handler: ~ error:", error);
        return res.status(500).send({
          code: -1,
          message: msgError[error.message] || "Lỗi hệ thống",
        });
      }
    },
  });
};

const msgError: any = {
  not_found_account: "Tài khoản không tồn tại",
  invalid_email_or_phone: "Email hoặc số điện thoại không đúng định dạng",
  invalid_otp: "Mã OTP không chính xác vui lòng thử lại",
  invalid_type_verify: "Loại xác thực không đúng",
};
