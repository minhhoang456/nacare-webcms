import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import cryptUtils from "@src/utils/crypt";
import { prismaClient } from "@root/src/utils/prisma";
import ono from "@jsdevtools/ono";
import User from "@root/src/services/user.service";
import { user as UserType } from "@prisma/client";
import customerService from "@root/src/services/customer.service";
import { SENDER_TYPE } from "@root/src/types/chat.type";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/login",
    // Define your schema
    schema: {
      body: z.object({
        username: z.string().min(3).describe("Tên đăng nhập"),
        password: z.string().min(1).describe("Mật khẩu đăng nhập"),
        tokenCapcha: z.string().describe("Token của captcha"),
      }),
      // querystring: {},
      // response: {},
    },
    handler: async (req, res) => {
      try {
        const { password, username, tokenCapcha } = req.body;
        await cryptUtils.checkCaptchaV3(tokenCapcha);
        const userInfo = (await prismaClient.user.findFirst({
          where: {
            username,
          },
        })) as UserType & {
          role?: number | null;
          partnerIds?: number[] | null;
        };
        if (!userInfo)
          throw ono(
            { code: "e_invalid_user_password", status: 400 },
            "User does not exist"
          );
        const checkHash = await cryptUtils.checkHash(
          password,
          userInfo.password || ""
        );
        if (!checkHash)
          throw ono(
            { code: "e_invalid_user_password", status: 400 },
            "User does not exist"
          );
        const token = await User.createToken({
          userId: userInfo.id,
          roleId: userInfo.roleId || 0,
          roleSpecial: userInfo.roleSpecial || "",
          storeId: userInfo.storeId || 0,
        });
        const tokenChat = customerService.createTokenChat(
          userInfo.id,
          SENDER_TYPE.SELLER,
          userInfo.storeId || 0
        );
        userInfo.role = userInfo.roleId;
        return res.send({
          code: 0,
          data: {
            token,
            userInfo,
            tokenChat,
          },
          message: "Thành công",
        });
      } catch (error: any) {
        switch (error.code) {
          case "e_invalid_captcha":
            return res.code(400).send({
              code: 1,
              message: "Lỗi xác thực captcha",
            });
          case "e_invalid_user_password":
            return res.code(400).send({
              code: 3,
              message: "Sai tên đăng nhập hoặc mật khẩu",
            });
          default:
            return res
              .code(400)
              .send({ code: -1, message: "Lỗi hệ thống", error });
        }
      }
    },
  });
};
