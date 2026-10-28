import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
// import { z } from "zod";
import pageMiddleware from "@src/middleware/page";
import { Prisma, RoleSpecial } from "@prisma/client";
import { prismaClient } from "@root/src/utils/prisma";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/create`,
    preHandler: [userMidlleware as any, pageMiddleware, actionLogMidlleware],
    // Define your schema
    schema: {
      // body: z.object({
      // }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        // @ts-ignore
        req.autoGenerateModel = true;
        const data: any = req.body;
        // @ts-ignore
        const storeId = req.storeId;
        // @ts-ignore
        const roleSpecial = req.roleSpecial;
        if (roleSpecial !== RoleSpecial.SHOP) {
          throw new Error("Bạn không có quyền truy cập");
        }
        const tableName = "depot";
        const models = Prisma.dmmf.datamodel.models;
        const modelItemField = models.find((e) => e.name === tableName)?.fields;
        for (const key in data) {
          const fieldInfo = modelItemField?.find((e: any) => e.name === key);
          if (!fieldInfo) {
            delete data[key];
            continue;
          }
          if (fieldInfo.type === "Boolean") {
            data[key] = data[key] ? true : false;
          }
          // parse value to number if type is number
          if (fieldInfo.type === "Int" || fieldInfo.type === "Float") {
            data[key] = Number(data[key]);
          }
        }
        if (storeId) {
          data.storeId = storeId;
        }
        const newItem = await prismaClient.depot.create({ data });
        return res.send(newItem);
      } catch (err: any) {
        console.log(err);
        return res.code(500).send({
          code: 1,
          message: "Đã có lỗi xảy ra",
          error: err?.message,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
