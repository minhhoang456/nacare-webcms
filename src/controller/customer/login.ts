import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import ono from "@jsdevtools/ono";
import crypt from "@root/src/utils/crypt";
import { customerService } from "@root/src/services";
import redis from "@root/src/utils/redis";
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/login`,
    // Define your schema
    schema: {
      tags: ["Customer"],
      description: "Đăng nhập tài khoản khách hàng",
      body: z.object({
        emailOrPhone: z.string(),
        password: z.string(),
      }),
      response: {},
    },
    handler: async (req, res) => {
      const { emailOrPhone, password } = req.body;
      try {
        const customer: any =
          await customerService.getCustomerByMerchantRef(emailOrPhone);
        if (!customer) throw ono("e_not_found_customer");
        const checkHash = await crypt.checkHash(password, customer.secure);
        if (!checkHash) throw ono("e_invalid_user_password");
        delete customer.secure;
        const [_, token] = await Promise.all([
          redis.set(
            customerService.getCustomerKey(customer.id),
            JSON.stringify(customer),
            "EX",
            300,
          ),
          customerService.createToken(customer.id),
        ]);
        return res.status(200).send({
          code: 0,
          message: "Đăng nhập thành công",
          data: customer,
          token: token,
        });
      } catch (error: any) {
        return res.status(404).send({
          code: -1,
          message: msg[error.message] || "Hệ thống bận",
        });
      }
    },
  });
};

const msg: any = {
  invalid_email_or_phone: "Email hoặc số điện thoại không hợp lệ",
  e_invalid_user_password: "Email hoặc số điện thoại hoặc mật khẩu không đúng",
  e_not_found_customer: "Email hoặc số điện thoại không tồn tại",
};
// skip: z
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
