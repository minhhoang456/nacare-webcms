import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { RoleSpecial } from "@prisma/client";
import { prismaClient } from "@root/src/utils/prisma";
import moment from "moment";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/check-account-exist`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        storeId: z.number(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        //@ts-ignore
        const roleSpecial = req.roleSpecial;
        if (roleSpecial !== RoleSpecial.ADMIN) {
          return res.code(403).send({
            code: 403,
            message: "Bạn không có quyền truy cập",
          });
        }
        const store = await prismaClient.store.findUnique({
          where: {
            id: req.body.storeId,
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
            storeId: req.body.storeId,
          },
        });
        if (account) {
          return res.send({
            code: 0,
            message: "Tài khoản đã tồn tại",
            data: {
              exist: true,
              accountInfo: {
                storeName: store.name,
                email: store.email,
                createdAt: moment(Number(store.createdAt)).format("DD/MM/YYYY"),
                logo: store.logo,
                address: store.address,
                username: account.username,
              },
            },
          });
        } else {
          return res.send({
            code: 0,
            message: "Chưa có tài khoản",
            data: {
              exist: false,
            },
          });
        }
      } catch (err) {
        return res.code(500).send({
          code: 500,
          message: "Lỗi server",
          error: err,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
