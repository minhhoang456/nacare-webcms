import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import pageMiddleware from "@src/middleware/page";
import { Prisma, RoleSpecial } from "@prisma/client";
import { prismaClient } from "@root/src/utils/prisma";
import locationData from "@root/data/location.json";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-list`,
    preHandler: [userMidlleware as any, pageMiddleware, actionLogMidlleware],
    // Define your schema
    schema: {
      // body: z.object({
      // }),
      querystring: z.object({
        page: z.any().optional(),
        api: z.string().optional(),
        queryInput: z.any().optional(),
        skip: z.any().optional(),
        limit: z.any().optional(),
        where: z.any().optional(),
        search: z.any().optional(),
        sort: z.any().optional(),
        select: z.any().optional(),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const {
          skip = 0,
          limit = 100,
          sort = '[{ "name": "asc" }]',
          // order = "desc",
          where,
          select,
          search,
        } = req.query as any;
        const query = {
          ...JSON.parse(where || "{}"),
          ...(search ? JSON.parse(search) : undefined),
          parentId: 0,
        };
        const tableName = "depot";
        // @ts-ignore
        const storeId = req.storeId;
        // @ts-ignore
        const roleSpecial = req.roleSpecial;
        if (roleSpecial !== RoleSpecial.SHOP) {
          throw new Error("Bạn không có quyền truy cập");
        }
        const models = Prisma.dmmf.datamodel.models;
        const modelItemField = models.find((e) => e.name === tableName)?.fields;
        for (const key in query) {
          const fieldInfo = modelItemField?.find((e: any) => e.name === key);
          if (!fieldInfo) {
            delete query[key];
            continue;
          }
          if (fieldInfo?.type === "Boolean") {
            query[key] = query[key] ? true : false;
          }
          // parse value to number if type is number
          if (
            typeof query[key] === "string" &&
            (fieldInfo?.type === "Int" ||
              fieldInfo?.type === "Float" ||
              fieldInfo?.type === "Decimal" ||
              fieldInfo?.type === "BigInt")
          ) {
            query[key] = Number(query[key]);
          }
          if (Array.isArray(query[key])) {
            query[key] = {
              in: query[key],
            };
          }
          if (query[key].contains) {
            if (
              fieldInfo?.kind === "enum" &&
              typeof query[key] === "object" &&
              Object.keys(query[key]).length === 1
            ) {
              query[key] = query[key].contains;
            } else {
              query[key] = {
                ...query[key],
              };
            }
          }
        }
        if (storeId) {
          query.storeId = storeId;
        }
        const fullQuery: Prisma.depotFindManyArgs = {
          where: query as any,
          skip: Number(skip),
          take: Number(limit),
          select,
        };
        if (typeof sort === "string") {
          fullQuery.orderBy = JSON.parse(sort).flatMap((obj: any) =>
            Object.entries(obj).map(([key, value]) => ({ [key]: value }))
          );
        } else {
          fullQuery.orderBy = sort.flatMap((obj: any) =>
            Object.entries(obj).map(([key, value]) => ({ [key]: value }))
          );
        }
        const [rows, count] = await prismaClient.$transaction([
          prismaClient.depot.findMany(fullQuery),
          prismaClient.depot.count({
            where: query,
          }),
        ]);
        const provinceList = Array.isArray(locationData.province) ? locationData.province : [];
        const wardList = Array.isArray(locationData.ward) ? locationData.ward : [];
        const provinceMap = new Map<number, string>(provinceList.map((p: any) => [p.id, p.name]));
        const wardMap = new Map<number, string>(wardList.map((w: any) => [w.id, w.name]));

        for (const item of rows) {
          const wardName = item.wardId ? (wardMap.get(item.wardId) || (locationData.ward as any)?.[String(item.wardId)] || "") : "";
          const provinceName = item.provinceId ? (provinceMap.get(item.provinceId) || (locationData.province as any)?.[String(item.provinceId)] || "") : "";
          // @ts-ignore
          item.fullAddress = [item.address, wardName, provinceName].filter(Boolean).join(", ");
        }
        return res.send({
          code: 0,
          message: "Thành công",
          data: rows,
          count,
        });
      } catch (err) {
        console.log("🚀 ~ handler: ~ err:", err);
        return res.status(500).send({
          message: "Đã có lỗi xảy ra!",
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
