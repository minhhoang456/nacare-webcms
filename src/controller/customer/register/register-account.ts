import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { customerService } from '@root/src/services';
import { v4 as uuidv4 } from 'uuid';
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/register-account`,
    schema: {
      tags: ['Customer'],
      summary: 'Customer - Đăng ký tài khoản khách hàng',
      description: 'Register customer',
      body: z.object({
        emailOrPhone: z.string(),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      const { emailOrPhone } = req.body;
      const keyPrivate = uuidv4();
      try {
        const type = await customerService.validateAndSendOtp({
          emailOrPhone,
          typeSendOtp: 'register',
          keyPrivate,
          key: emailOrPhone
        })
        return {
          code: 0,
          keyPrivate,
          message: `Vui lòng truy cập vào ${type} để xác thực tài khoản!`,
        };
      } catch (error: any) {
        console.log("🚀 ~ handler: ~ error:", error)
        if (error.message === 'limit_send_otp_request_id') {
          return res.send({
            code: -1,
            message: `Vui lòng chờ ${error.ttl} giây trước khi gửi lại yêu cầu OTP`,
          });
        }
        return res.status(400).send({
          code: -1,
          message: msgError[error.message] || 'Lỗi hệ thống'
        });
      }
    },
  });
};


const msgError: any = {
  invalid_email_or_phone: 'Email hoặc số điện thoại không đúng định dạng',
  exists_account: 'Email hoặc số điện thoại đã được sử dụng , vui lòng thử lại',
  invalid_type_send_otp: 'Loại xác thực không đúng',
  error_send_otp: 'Lỗi khi gửi OTP, vui lòng thử lại sau',
}
