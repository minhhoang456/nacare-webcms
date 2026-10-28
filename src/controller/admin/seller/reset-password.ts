import { RoleSpecial } from "@prisma/client";
import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import { prismaClient } from "@root/src/utils/prisma";
import redis from "@root/src/utils/redis";
import ono from "@jsdevtools/ono";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import cryptUtils from "@src/utils/crypt";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/reset-password`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        newPassword: z.string().min(1).describe("Mật khẩu mới"),
        confirmPassword: z.string().min(1).describe("Mật khẩu xác nhận"),
        tokenCapcha: z.string().min(1).describe("Token của captcha"),
        captchaText: z.string().min(1).describe("Mã captcha"),
        storeId: z.number().min(1).describe("ID cửa hàng"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const {
          newPassword,
          confirmPassword,
          tokenCapcha,
          captchaText,
          storeId,
        } = req.body;
        //@ts-ignore
        const roleSpecial = req.roleSpecial;
        if (roleSpecial !== RoleSpecial.ADMIN) {
          return res.code(403).send({
            code: 403,
            message: "Bạn không có quyền truy cập",
          });
        }
        if (newPassword !== confirmPassword) {
          return res.code(400).send({
            code: 400,
            message: "Mật khẩu xác nhận không chính xác",
          });
        }
        let captchaInfo: any = await redis.get(tokenCapcha);
        if (!captchaInfo)
          throw ono({
            code: "e_invalid_token_captcha",
          });
        captchaInfo = JSON.parse(captchaInfo);
        if (captchaInfo.text !== captchaText)
          throw ono({
            code: "e_invalid_captcha",
          });
        const store = await prismaClient.store.findUnique({
          where: {
            id: storeId,
          },
        });
        if (!store) {
          return res.code(404).send({
            code: 404,
            message: "Cửa hàng không tồn tại",
          });
        }
        const account = await prismaClient.user.findFirst({
          where: {
            storeId: storeId,
          },
        });
        if (!account) {
          return res.code(404).send({
            code: 404,
            message: "Tài khoản không tồn tại",
          });
        }
        const hashedPassword = (await cryptUtils.hash(newPassword)) as string;
        await prismaClient.user.update({
          where: {
            id: account.id,
          },
          data: {
            password: hashedPassword,
            roleSpecial: account.roleSpecial,
            username: account.username,
            name: account.name,
            email: account.email,
            roleId: account.roleId,
          }
        });
        return res.send({
          code: 0,
          message: "Đổi mật khẩu thành công",
        });
      } catch (error: any) {
        if (error.code === "e_invalid_token_captcha" || error.code === "e_invalid_captcha") {
          return res.code(400).send({
            code: 400,
            message: "Mã captcha không chính xác",
          });
        }
        console.log(error);
        return res.code(500).send({
          code: 500,
          message: "Lỗi server",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
