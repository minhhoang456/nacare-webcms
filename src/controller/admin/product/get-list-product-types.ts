import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
// import pageMiddleware from "@src/middleware/page";
import _ from "lodash";
import { productTypeService } from "@root/src/services";
import productHelper from "@root/src/helpers/product.helper";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-list-product-types`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      // body: z.object({
      // }),
      querystring: z.object({
        page: z.any().optional(),
        api: z.string().optional(),
        queryInput: z.any().optional(),
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        where: z.any().optional(),
        search: z.any().optional(),
        sort: z.any().optional(),
        select: z.any().optional(),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { queryInput, skip, limit } = req.query as any;
        const parsedInput = JSON.parse(queryInput);
        let results: any = [];
        const repositoryRedisOMProduct =
          productTypeService.getRepositoryRedisOm();
        const sortQuery: any = {
          sort: "DESC",
          field: "id",
        };
        let listQuery = repositoryRedisOMProduct.search();
        let countQuery = repositoryRedisOMProduct.search();
        let totalQuerySearch = 0;
        let idsQuerySearch: number[] = [];

        if (parsedInput.id) {
          listQuery = listQuery.and("id").eq(Number(parsedInput.id));
          countQuery = countQuery.and("id").eq(Number(parsedInput.id));
        }
        if (parsedInput.storeId) {
          listQuery = listQuery.and("storeId").eq(Number(parsedInput.storeId));
          countQuery = countQuery.and("storeId").eq(Number(parsedInput.storeId));
        }
        if (parsedInput.name) {
          const { ids, total } = await productHelper.searchProductTypeByKeyword(
            {
              searchText: parsedInput.name,
              skip,
              limit,
            }
          );
          if (ids.length === 0) {
            return res.send({
              code: 0,
              message: "Thành công",
              data: [],
              total: 0,
            });
          }
          totalQuerySearch = total;
          idsQuerySearch = ids;
          listQuery = listQuery
            .and("ids")
            .containOneOf(...ids.map((id) => id.toString()));
          countQuery = countQuery
            .and("ids")
            .containOneOf(...ids.map((id) => id.toString()));
        }
        if (parsedInput.name) {
          results = await Promise.all([
            listQuery.return.sortBy(sortQuery.field, sortQuery.sort).all(),
            totalQuerySearch,
          ]);
        } else {
          results = await Promise.all([
            listQuery.return.sortBy(sortQuery.field, sortQuery.sort).all(),
            countQuery.return.count(),
          ]);
        }
        
        let total = results[1];
        if (results[0].length > 0) {
          let listProduct = results[0].map((e: any) => {
            try {
              const productInfo = JSON.parse(e.fullProductTypeInfoRef as any);
              return productInfo;
            } catch (error) {
              return e;
            }
          });

          if (parsedInput.name && totalQuerySearch > 0) {
            listProduct = listProduct.sort(
              (a: any, b: any) =>
                idsQuerySearch.indexOf(a.id) - idsQuerySearch.indexOf(b.id)
            );
            listProduct = listProduct.slice(skip, skip + limit);
          }

          return res.send({
            code: 0,
            data: listProduct,
            total: total,
            message: "Thành công",
          });
        }

        return {
          code: 0,
          message: "Thành công",
          data: [],
          total: 0,
        };
      } catch (err: any) {
        switch (err.message) {
          default:
            return {
              code: -1,
              message: "Lỗi hệ thống " + err,
              detail: err,
            };
        }
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
