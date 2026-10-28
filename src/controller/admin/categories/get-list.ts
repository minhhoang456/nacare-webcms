import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import { prismaClient } from "@root/src/utils/prisma";
import { Prisma } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import pageMiddleware from "@src/middleware/page";

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
      //
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
        const tableName = "category";
        const models = Prisma.dmmf.datamodel.models;
        const modelItemField = models.find((e) => e.name === tableName)?.fields;
        for (const key in query) {
          const fieldInfo = modelItemField?.find((e: any) => e.name === key);
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
        const fullQuery: Prisma.categoryFindManyArgs = {
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
        const sortById = Array.isArray(fullQuery.orderBy)
          ? fullQuery.orderBy.find((e: any) => e.id)
          : undefined;
        if (sortById) {
          fullQuery.orderBy = [
            {
              name: "asc",
            },
          ];
        }
        const [rows, count] = await prismaClient.$transaction([
          prismaClient.category.findMany(fullQuery),
          prismaClient.category.count({
            where: query,
          }),
        ]);
        if (rows.length > 0) {
          const parentIds = rows.map((e) => e.id);
          const childrens = await prismaClient.category.findMany({
            where: {
              parentId: {
                in: parentIds,
              },
            },
            orderBy: {
              name: "asc",
            },
          });
          for (const parent of rows) {
            const children = childrens.filter((e) => e.parentId === parent.id);
            // @ts-ignore
            parent.children = children;
          }
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
