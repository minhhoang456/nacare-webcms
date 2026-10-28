import pageMiddleware from "@src/middleware/page";
import { prismaClient } from "@src/utils/prisma";
import cryptUtils from "@src/utils/crypt";
import ono from "@jsdevtools/ono";
// import redis from '@root/src/utils/redis'
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import moment from "moment";
import userMidlleware from "@root/src/middleware/user";
import actionLogMidlleware from "@root/src/middleware/actionLog";
import redis from "@root/src/utils/redis";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/reset-password`,
    preHandler: [userMidlleware as any, pageMiddleware, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        id: z.number().min(1),
        newPassword: z.string().min(1),
        confirmPassword: z.string().min(1),
        captcha: z.string().min(1),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { newPassword, confirmPassword, id, captcha } = req.body;
        const [tokenCapcha, captchaText] = captcha.split(",");
        let captchaInfo: any = await redis.get(tokenCapcha);
        if (!captchaInfo)
          throw ono({
            code: "e_invalid_captcha",
          });
        captchaInfo = JSON.parse(captchaInfo);
        if (captchaInfo.text !== captchaText)
          throw ono({
            code: "e_invalid_captcha",
          });
        if (newPassword !== confirmPassword)
          throw ono({
            code: "e_password_does_not_match",
          });
        let userInfo = await prismaClient.user.findUnique({ where: { id } });
        if (!userInfo || !userInfo.roleId)
          throw ono({
            code: "e_user_not_found",
          });
        const roleSpecial = await prismaClient.role.findFirst({
          where: {
            id: userInfo.roleId,
          },
        });
        const hash = (await cryptUtils.hash(newPassword)) as string;
        await prismaClient.user.update({
          where: {
            id,
          },
          data: {
            password: hash,
            changePasswordAt: moment().valueOf(),
            roleSpecial: roleSpecial?.special,
          },
        });

        return res.send({ code: 0, message: "Đổi mật khẩu thành công" });
      } catch (err: any) {
        switch (err.code) {
          case "e_invalid_captcha":
            return res.send({ code: 1, message: "Sai mã captcha" });
          case "e_invalid_old_password":
            return res.send({ code: 2, message: "Mật khẩu cũ không đúng" });
          case "e_password_does_not_match":
            return res.send({ code: 3, message: "Mật khẩu không khớp" });
          case "e_user_not_found":
            return res.send({ code: 4, message: "Không tìm thấy tài khoản" });
          default:
            return res.send({ code: -1, message: "Lỗi hệ thống" });
        }
      }
    },
  });
};
