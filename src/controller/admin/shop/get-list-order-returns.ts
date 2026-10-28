import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prismaClient } from "@root/src/utils/prisma";
import OrderReturnsService from "@root/src/services/OrderReturns.service";
import pageMiddleware from "@root/src/middleware/page";
import _ from "lodash";
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-list-order-returns`,
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
          sort = '[{ "createdAt": "asc" }]',
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
        const tableName = "OrderReturns";
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
        const fullQuery: Prisma.OrderReturnsFindManyArgs = {
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
        const queryCountReturnOrder = _.omit(query, "status");
        const [rows, count, statusCounts] = await Promise.all([
          prismaClient.orderReturns.findMany(fullQuery),
          prismaClient.orderReturns.count({
            where: query,
          }),
          OrderReturnsService.countOrderReturns(queryCountReturnOrder),
        ]);
        if (rows.length > 0) {
          const orderShipReturnInfos = await prismaClient.ordership.findMany({
            where: {
              returnForOrderId: {
                in: rows.map((e) => e.orderId),
              },
            },
          });
          rows.forEach((e) => {
            const orderShipReturnInfo = orderShipReturnInfos.find(
              (item) => item.returnForOrderId === e.orderId
            );
            if (orderShipReturnInfo) {
              // @ts-ignore
              e.returnShipment = orderShipReturnInfo;
            } else {
              // @ts-ignore
              e.returnShipment = null;
            }
          });
        }
        return res.send({
          code: 0,
          message: "Thành công",
          data: rows,
          count,
          statusCounts,
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
