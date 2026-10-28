import { Prisma, RoleSpecial } from "@prisma/client";
import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
// import pageMiddleware from "@root/src/middleware/page";

// Thêm hàm đếm số lượng theo trạng thái
const countByStatus = async (query: any, tx?: Prisma.TransactionClient) => {
  const client: any = tx || prismaClient;

  const queryWithoutStatus = { ...query };
  if (queryWithoutStatus.status) {
    delete queryWithoutStatus.status;
  }

  const groupedCounts = await client.ordership.groupBy({
    by: ['status'],
    where: queryWithoutStatus,
    _count: {
      status: true
    }
  });

  const counts: Record<string, number> = {
    pending: 0,
    processing: 0,
    wait_for_confirmation: 0,
    wait_for_pickup: 0,
    shipping: 0,
    completed: 0,
    canceled: 0,
    refund: 0,
    refunded: 0,
    failed: 0
  };

  groupedCounts.forEach((item: any) => {
    if (item.status && item._count) {
      counts[item.status] = item._count.status;
    }
  });

  return counts;
};

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-orders-ship`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      // body: z.object({
      // }),
      querystring: z.object({
        page: z.any().optional(),
        api: z.string().optional(),
        queryInput: z.string().optional().describe("Điều kiện lọc"),
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
        const { skip = 0, limit = 100, sort = '[{ "createdAt": "desc" }]', where, search, select, queryInput } = req.query;

        // Xử lý queryInput nếu có
        let queryInputParse: any = {};
        // if (queryInput) {
        //   queryInputParse = JSON.parse(queryInput);
        // }
        if (queryInput && typeof queryInput === 'string') {
          const parsedQuery: any = JSON.parse(queryInput);

          // Xử lý tìm kiếm trong array orderItemInfos
          if (parsedQuery['orderItemInfos.typeId']) {
            queryInputParse = {
              orderItemInfos: {
                some: {
                  typeId: parsedQuery['orderItemInfos.typeId']
                }
              }
            };
          }

          if (parsedQuery.status) {
            queryInputParse.status = parsedQuery.status;
          }

          // Tìm kiếm theo khoảng giá
          if (parsedQuery.totalMoney) {
            if (parsedQuery.totalMoney.min) {
              queryInputParse.totalMoney = {
                ...queryInputParse.totalMoney,
                gte: parsedQuery.totalMoney.min
              };
            }
            if (parsedQuery.totalMoney.max) {
              queryInputParse.totalMoney = {
                ...queryInputParse.totalMoney,
                lte: parsedQuery.totalMoney.max
              };
            }
          }

          if (parsedQuery.createdAt) {
            queryInputParse.createdAt = {};

            if (parsedQuery.createdAt.gte) {
              queryInputParse.createdAt.gte = parsedQuery.createdAt.gte;
            }

            if (parsedQuery.createdAt.lte) {
              queryInputParse.createdAt.lte = parsedQuery.createdAt.lte;
            }
          }

          if (parsedQuery.id) {
            queryInputParse.id = parsedQuery.id;
          }

          if (parsedQuery.receiveName) {
            queryInputParse.receiveName = parsedQuery.receiveName;
          }

          if (parsedQuery.shipOrderCodeId) {
            queryInputParse.shipOrderCodeId = parsedQuery.shipOrderCodeId;
          }
          if (parsedQuery.customerId) {
            queryInputParse.customerId = parsedQuery.customerId;
          }
        }
        const query = {
          ...JSON.parse(where || "{}"),
          ...queryInputParse,
          ...(search ? JSON.parse(search) : undefined),
        };
        const tableName = "ordership";
        // @ts-ignore
        const storeId = req.storeId;
        // @ts-ignore
        const roleSpecial = req.roleSpecial;
        if (![RoleSpecial.SHOP, RoleSpecial.ROOT, RoleSpecial.ADMIN].includes(roleSpecial)) {
          throw new Error("Bạn không có quyền truy cập");
        }

        const models = Prisma.dmmf.datamodel.models;
        const modelItemField = models.find((e: any) => e.name === tableName)?.fields;
        // Thêm xử lý đặc biệt cho nested fields như orderItemInfos

        for (const key in query) {
          const fieldInfo = modelItemField?.find((e: any) => e.name === key);
          if (!fieldInfo) {
            delete query[key];
            continue;
          }

          if (query[key] && typeof query[key] === 'object' && query[key].contains) {
            if (fieldInfo?.kind === "enum") {
              query[key] = query[key].contains;
            } else if (fieldInfo?.type === "String") {
              query[key] = {
                contains: query[key].contains,
                mode: 'insensitive' // mode insensitive để không phân biệt hoa thường
              };
            } else {
              query[key] = {
                ...query[key]
              };
            }
            continue;
          }

          if (fieldInfo?.type === "Boolean") {
            query[key] = query[key] ? true : false;
          }

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
        }
        if (storeId && roleSpecial === RoleSpecial.SHOP) {
          query.storeId = storeId;
        }
        const fullQuery: Prisma.ordershipFindManyArgs = {
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
        const [rows, count, statusCounts] = await Promise.all([
          prismaClient.ordership.findMany(fullQuery),
          prismaClient.ordership.count({
            where: query,
          }),
          countByStatus(query)
        ]);

        return res.send({
          code: 0,
          data: rows,
          count,
          statusCounts,
        });
      } catch (error) {
        console.log(error);
        return res.send({
          code: 1,
          message: "Lỗi khi lấy đơn hàng",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
