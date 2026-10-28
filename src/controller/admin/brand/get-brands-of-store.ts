import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prismaClient } from "@root/src/utils/prisma";
import { Prisma } from "@root/src/utils/prisma";
import userMidlleware from "@root/src/middleware/user";
import actionLogMidlleware from "@root/src/middleware/actionLog";
import pageMiddleware from "@root/src/middleware/page";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-brands-of-store`,
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
        } = req.query;

        const query = {
          ...JSON.parse(where || "{}"),
          ...(search ? JSON.parse(search) : undefined),
        };
        const tableName = "brand_store";
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
        // @ts-ignore
        const storeId = req.storeId;
        const brandStores = await prismaClient.brandStore.findMany({
          where: {
            storeId: storeId,
            // @ts-ignore
            // userId: req.userId,
          },
          skip: Number(skip),
          take: Number(limit),
        });

        let brands: any[] = [];
        let count = 0;
        if (brandStores.length > 0) {
          // Flatten array brandIds từ JSON
          const brandIds = brandStores
            .map((e: any) => e.brandId)
            .flat()
            .filter(id => id !== null && id !== undefined);

          let [brandsInfo, totalCount] = await Promise.all([
            prismaClient.brand.findMany({
              where: {
                id: { in: brandIds },
              },
              skip: Number(skip),
              take: Number(limit),
              select,
            }),
            prismaClient.brand.count({
              where: {
                id: { in: brandIds },
              },
            }),
          ]);
          
          // Trả về chỉ thông tin brand, không phải brandStore
          brands = brandsInfo;
          count = totalCount;
        }
        return res.code(200).send({
          code: 0,
          message: "Lấy danh sách thương hiệu thành công",
          data: brands,
          count,
        });
      } catch (error) {
        console.log(error);
        return res.code(500).send({
          code: 500,
          message: "Đã có lỗi xảy ra, vui lòng thử lại sau",
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
