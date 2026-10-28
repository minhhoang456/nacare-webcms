import { ono } from "@jsdevtools/ono";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import crypt from "@root/src/utils/crypt";
import { prismaClient } from "@root/src/utils/prisma";
import customerMiddleware from "@root/src/middleware/customer";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/set-password`,
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Customer - Đặt mật khẩu",
      description: "Set password",
      body: z.object({
        password: z.string(),
        confirmPassword: z.string(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { customerId } = req;
        const { password, confirmPassword } = req.body;
        if (password !== confirmPassword) {
          throw ono("password_not_match");
        }
        // if (!common.checkPasswordStrength(password)) {
        //   throw ono("password_not_enough_strong");
        // }
        const customer = await prismaClient.customer.findUnique({
          where: { id: customerId },
        });
        if (customer?.secure !== null) {
          throw ono("account_has_password");
        }

        const hashPassword: any = await crypt.hash(password);
        await prismaClient.customer.update({
          where: { id: customerId },
          data: { secure: hashPassword },
        });
        return res.send({ code: 0, message: "Success" });
      } catch (error: any) {
        return res
          .code(400)
          .send({ code: 1, message: msgError[error.message] || "Fail" });
      }
    },
  });
};

const msgError: any = {
  password_not_match: "Mật khẩu không khớp",
  password_not_enough_strong: "Mật khẩu không đủ mạnh",
  account_has_password: "Tài khoản đã có mật khẩu",
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
