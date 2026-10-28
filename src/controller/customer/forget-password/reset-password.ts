import ono from "@jsdevtools/ono";
import customerService from "@root/src/services/customer.service";
import crypt from "@root/src/utils/crypt";
import { prismaClient } from "@root/src/utils/prisma";
import redis from "@root/src/utils/redis";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "PUT",
    url: `/reset-password`,
    schema: {
      tags: ["Customer"],
      summary: "Customer - Đặt lại mật khẩu",
      description: "Customer - Đặt lại mật khẩu",
      body: z.object({
        emailOrPhone: z.string(),
        otp: z.string(),
        keyPrivate: z.string(),
        password: z.string(),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      const { emailOrPhone, otp, keyPrivate, password } = req.body;
      try {
        const { customer } = await customerService.processOtpVerification({
          emailOrPhone: emailOrPhone,
          typeVerify: "forget_password",
          keyPrivate,
          otp,
        });
        const data = await updatePassword({
          emailOrPhone,
          password,
          dataCustomer: customer,
        });
        await redis.del(`forgetPassword:${emailOrPhone}`);
        return res.status(200).send({
          code: 0,
          message: `Đặt lại mật khẩu thành công!`,
          token: data.tokenAccess,
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

async function updatePassword(params: {
  emailOrPhone: string;
  password: string;
  dataCustomer: any;
}) {
  const { emailOrPhone, password, dataCustomer } = params;
  const hashPassword: any = await crypt.hash(password);
  const customer = await prismaClient.customer.update({
    where: { id: dataCustomer?.id },
    data: {
      secure: hashPassword,
    },
  });
  if (!customer) throw ono("e_update_password");
  const [tokenAccess] = await Promise.all([
    customerService.createToken(customer.id),
    redis.del(emailOrPhone),
  ]);
  return { customer, tokenAccess };
}

const msgError: any = {
  invalid_otp: "Mã OTP không chính xác vui lòng thử lại",
  e_update_password: "Lỗi reset mật khẩu , vui lòng thử lại sau vài phút",
  not_found_account: "Tài khoản không tồn tại",
  invalid_type_verify: "Loại xác thực không đúng",
  invalid_email_or_phone: "Email hoặc số điện thoại không đúng định dạng",
};
