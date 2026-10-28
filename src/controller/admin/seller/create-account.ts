import { RoleSpecial } from "@prisma/client";
import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import cryptUtils from "@src/utils/crypt";
import redis from "@root/src/utils/redis";
import ono from "@jsdevtools/ono";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/create-account`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        storeId: z.number().describe("ID cửa hàng"),
        username: z.string().describe("Tên đăng nhập"),
        password: z.string().describe("Mật khẩu"),
        confirmPassword: z.string().describe("Mật khẩu xác nhận"),
        captchaText: z.string().min(1).describe("Mã captcha"),
        tokenCapcha: z.string().min(1).describe("Token của captcha"),
        brandIds: z.array(z.number()).describe("ID của các thương hiệu"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const {
          storeId,
          username,
          password,
          confirmPassword,
          captchaText,
          tokenCapcha,
          brandIds,
        } = req.body;
        //@ts-ignore
        const roleSpecial = req.roleSpecial;
        if (roleSpecial !== RoleSpecial.ADMIN) {
          return res.code(403).send({
            code: 403,
            message: "Bạn không có quyền truy cập",
          });
        }
        if (password !== confirmPassword) {
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
        if (brandIds.length > 0) {
          const brands = await prismaClient.brand.findMany({
            where: {
              id: { in: brandIds },
            },
          });
          if (brands.length !== brandIds.length) {
            return res.code(404).send({
              code: 404,
              message: "Thương hiệu không tồn tại",
            });
          }
        }
        const account = await prismaClient.user.findFirst({
          where: {
            OR: [{ username: username }, { storeId: storeId }],
          },
        });
        if (account) {
          return res.code(400).send({
            code: 400,
            message: "Tài khoản đã tồn tại",
          });
        }
        const roleSeller = await prismaClient.role.findFirst({
          where: {
            special: RoleSpecial.SHOP,
          },
        });
        if (!roleSeller) {
          return res.code(404).send({
            code: 404,
            message: "Role không tồn tại",
          });
        }
        const hashedPassword = (await cryptUtils.hash(password)) as string;
        const user = await prismaClient.user.create({
          data: {
            username: username,
            name: store.name,
            email: store.email,
            roleId: roleSeller.id,
            phone: store.phone,
            address: store.address,
            applyStoreIds: [storeId],
            avatar: store.logo,
            roleSpecial: RoleSpecial.SHOP,
            password: hashedPassword,
            storeId: storeId,
          },
        });
        await prismaClient.brandStore.create({
          data: {
            brandId: brandIds,
            storeId: storeId,
            userId: user.id,
          },
        });
        return res.send({
          code: 0,
          message: "Tạo tài khoản thành công",
          data: user,
        });
      } catch (error: any) {
        if (
          error.code === "e_invalid_token_captcha" ||
          error.code === "e_invalid_captcha"
        ) {
          return res.code(400).send({
            code: 400,
            message: "Mã captcha không chính xác",
          });
        }
        console.log(error);
        return res.code(500).send({
          code: 500,
          message: "Lỗi server",
          error: error,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
