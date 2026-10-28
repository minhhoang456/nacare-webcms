import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import customerService from "@src/services/customer.service";
import { v4 as uuidv4 } from 'uuid';
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/request-forget-password`,
    schema: {
      tags: ['Customer'],
      summary: 'Customer - yêu cầu đặt lại mật khẩu',
      description: 'Customer - yêu cầu đặt lại mật khẩu',
      body: z.object({
        emailOrPhone: z.string()
      }),
      response: {},
    },
    handler: async (req, res) => {
      const { emailOrPhone } = req.body;
      const keyPrivate = uuidv4();
      try {
        const keyRedis = 'forgetPassword:' + emailOrPhone
        const type = await customerService.validateAndSendOtp({
          typeSendOtp: 'forget_password',
          emailOrPhone,
          keyPrivate,
          key: keyRedis
        })
        return res.status(200).send({
          code: 0,
          message: `Vui lòng kiểm tra ${type} để lấy OTP`,
          keyPrivate: keyPrivate,
        })

      } catch (error: any) {
        if (error.message === 'limit_send_otp_request_id') {
          return res.send({
            code: -1,
            message: `Vui lòng chờ ${error.ttl} giây trước khi gửi lại yêu cầu OTP`,
          });
        }
        return res.status(500).send({
          code: -1,
          message: msgError[error.message] || 'Hệ thống bận',
        });
      }

    },
  });
};

const msgError: any = {
  not_found_account: 'Tài khoản không tồn tại',
  exists_account: 'Tài khoản đã tồn tại',
  invalid_email_or_phone: 'Email hoặc số điện thoại không đúng định dạng',
  invalid_otp: 'OTP không đúng',
  account_not_has_password: 'Tài khoản không có mật khẩu',
}

// skip: z
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),