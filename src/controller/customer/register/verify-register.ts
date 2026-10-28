import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import customerService from '@root/src/services/customer.service';
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/verify-register`,
    schema: {
      tags: ['Customer'],
      summary: 'Customer - Xác thực OTP đăng ký tài khoản khách hàng',
      description: 'Verify OTP register customer',
      body: z.object({
        emailOrPhone: z.string(),
        otp: z.string(),
        keyPrivate: z.string()
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      const { emailOrPhone, otp, keyPrivate } = req.body;
      try {
        await customerService.processOtpVerification({
          emailOrPhone,
          typeVerify: 'register',
          keyPrivate,
          otp
        })
        return res.status(200).send({
          code: 0,
          message: `Xác thực tài khoản thành công!`
        });
      } catch (error: any) {
        console.log("🚀 ~ handler: ~ error:", error)
        return res.status(500).send({
          code: -1,
          message: msgError[error.message] || 'Lỗi hệ thống',
        });
      }
    },
  });
};

const msgError: any = {
  invalid_otp: 'Mã OTP không chính xác vui lòng thử lại',
  invalid_email_or_phone: 'Email hoặc số điện thoại không đúng định dạng',
  exists_account: 'Email hoặc số điện thoại đã được sử dụng , vui lòng thử lại',
}
