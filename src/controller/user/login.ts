import User from "@root/src/services/user.service";
import cryptUtils from "@src/utils/crypt";
import { prismaClient } from "@src/utils/prisma";
import ono from "@jsdevtools/ono";
import redis from "@root/src/utils/redis";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { user as UserType } from "@prisma/client";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/login`,
    // Define your schema
    schema: {
      body: z.object({
        username: z.string().min(2).describe("Tên đăng nhập"),
        password: z.string().min(1).describe("Mật khẩu đăng nhập"),
        tokenCapcha: z.string().min(1).describe("Token của captcha"),
        captchaText: z.string().min(1).describe("Mã captcha"),
      }),
      // querystring: {},
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { captchaText, password, tokenCapcha, username } = req.body;
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
        const userInfo = (await prismaClient.user.findFirst({
          where: { username },
        })) as UserType & {
          role?: number | null;
          partnerIds?: number[] | null;
        };
        if (!userInfo)
          throw ono({
            code: "e_invalid_user_password",
          });
        const checkHash = await cryptUtils.checkHash(
          password,
          userInfo.password || ""
        );
        if (!checkHash)
          throw ono({
            code: "e_invalid_user_password",
          });
        const token = await User.createToken({
          userId: userInfo.id,
          roleId: userInfo.roleId || 0,
          roleSpecial: userInfo.roleSpecial || "",
          storeId: userInfo.storeId || 0,
        });
        userInfo.role = userInfo.roleId;
        return {
          code: 0,
          data: {
            token,
            userInfo,
          },
          message: "Thành công",
        };
      } catch (error: any) {
        switch (error.code) {
          case "e_invalid_token_captcha":
            return res.send({ code: 1, message: "Sai mã token captcha" });
          case "e_invalid_captcha":
            return res.send({ code: 2, message: "Sai mã captcha" });
          case "e_invalid_user_password":
            return res.send({
              code: 3,
              message: "Sai tên đăng nhập hoặc mật khẩu",
            });
          default:
            return res.send({ code: -1, message: "Lỗi hệ thống" });
        }
      }
    },
  });
};
