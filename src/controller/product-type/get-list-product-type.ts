import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import productTypeService from "../../services/productType.service";
import { flashSaleProductService } from "@root/src/services";
import productHelper from "@root/src/helpers/product.helper";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/get-list-product-type`,
    // Define your schema
    schema: {
      tags: ["producttype"],
      summary: "Get list product type",
      description: "Get list product type",
      querystring: z.object({
        distance: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .optional()
          .describe("Distance")
          .default(5),
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        categoryId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .optional(),
        categoryIds: z
          .string()
          .optional()
          .transform((str) => (str ? str.split(",").map(Number) : undefined))
          .describe("ID danh mục"),
        isHot: z.enum(["true", "false"]).optional(),
        isStorefavorite: z.enum(["true", "false"]).optional(),
        storeId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .optional(),
        partnerId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .optional(),
        keyword: z.string().optional(),
        ids: z
          .string()
          .optional()
          .transform((str) => (str ? str.split(",").map(Number) : undefined)),
        sort: z.enum(["sell", "price", "random", "location", "new"]).optional(),
        typeSort: z.enum(["ASC", "DESC"]).optional(),
        flashSaleProductId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .optional()
          .describe("ID flashsale"),
        categoryStoreId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .optional()
          .describe("ID danh mục của cửa hàng"),
        brandId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .optional()
          .describe("ID thương hiệu"),
        brandIds: z
          .string()
          .optional()
          .transform((str) => (str ? str.split(",").map(Number) : undefined))
          .describe("ID thương hiệu"),
        minPrice: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .optional()
          .describe("Giá tối thiểu"),
        maxPrice: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .optional()
          .describe("Giá tối đa"),
        isSuggest: z
          .enum(["true", "false"])
          .optional()
          .describe("Sản phẩm gợi ý"),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const {
          skip,
          limit,
          categoryId,
          categoryIds,
          isHot,
          storeId,
          keyword,
          ids,
          sort,
          typeSort,
          partnerId,
          flashSaleProductId,
          categoryStoreId,
          brandId,
          brandIds,
          minPrice,
          maxPrice,
          isSuggest,
        } = req.query;

        const customerId: number = req.customerId;
        let results: any = [];
        let flashSaleProductInRedisOm: any = [];
        const repositoryRedisOMProduct =
          productTypeService.getRepositoryRedisOm();
        const sortQuery: any = {
          sort: "DESC",
          field: "id",
        };
        let totalQuerySearch = 0;
        let idsQuerySearch: number[] = [];
        let listQuery = repositoryRedisOMProduct.search();
        let countQuery = repositoryRedisOMProduct.search();
        if (categoryId) {
          listQuery = listQuery
            .and("categoryId")
            .eq(categoryId)
            .or("subCategoryId")
            .eq(categoryId);
          countQuery = countQuery
            .and("categoryId")
            .eq(categoryId)
            .or("subCategoryId")
            .eq(categoryId);
        }
        if (categoryIds && categoryIds.length > 0) {
          listQuery = listQuery
            .and("categoryIds")
            .containOneOf(...categoryIds.map((id: any) => id.toString()))
            .or("subCategoryIds")
            .containOneOf(...categoryIds.map((id: any) => id.toString()));
          countQuery = countQuery
            .and("categoryIds")
            .containOneOf(...categoryIds.map((id: any) => id.toString()))
            .or("subCategoryIds")
            .containOneOf(...categoryIds.map((id: any) => id.toString()));
        }
        if (storeId) {
          listQuery = listQuery.and("storeId").eq(storeId);
          countQuery = countQuery.and("storeId").eq(storeId);
        }

        if (partnerId) {
          listQuery = listQuery.and("partnerId").eq(partnerId);
          countQuery = countQuery.and("partnerId").eq(partnerId);
        }

        if (categoryStoreId) {
          listQuery = listQuery.and("categoryStoreId").eq(categoryStoreId);
          countQuery = countQuery.and("categoryStoreId").eq(categoryStoreId);
        }

        if (brandId) {
          listQuery = listQuery.and("brandId").eq(brandId);
          countQuery = countQuery.and("brandId").eq(brandId);
        }

        if (brandIds && brandIds.length > 0) {
          listQuery = listQuery
            .and("brandIds")
            .containOneOf(...brandIds.map((id: any) => id.toString()));
          countQuery = countQuery
            .and("brandIds")
            .containOneOf(...brandIds.map((id: any) => id.toString()));
        }

        if (minPrice) {
          listQuery = listQuery.and("paymentCash").gte(minPrice);
          countQuery = countQuery.and("paymentCash").gte(minPrice);
        }

        if (maxPrice) {
          listQuery = listQuery.and("paymentCash").lte(maxPrice);
          countQuery = countQuery.and("paymentCash").lte(maxPrice);
        }

        if (isHot == "true") {
          listQuery = listQuery.and("isHot").eq(1);
          countQuery = countQuery.and("isHot").eq(1);
        }
        if (ids && ids.length > 0) {
          listQuery = listQuery
            .and("ids")
            .containOneOf(...ids.map((id: any) => id.toString()));
          countQuery = countQuery
            .and("ids")
            .containOneOf(...ids.map((id: any) => id.toString()));
        }
        if (flashSaleProductId) {
          const now = new Date().getTime();
          const repositoryRedisOMFlashSale =
            flashSaleProductService.getRepositoryRedisOm();
          const listFlashSaleInRedisOm = await repositoryRedisOMFlashSale
            .search()
            .where("flashSaleProductId")
            .eq(flashSaleProductId)
            .and("startTime")
            .lte(now)
            .and("endTime")
            .gte(now)
            .sortBy("sequence", "ASC")
            .returnAll();
          if (listFlashSaleInRedisOm.length > 0) {
            flashSaleProductInRedisOm = listFlashSaleInRedisOm.map((e: any) => {
              try {
                return JSON.parse(e.fullFlashSaleInfo as any);
              } catch (error) {
                return e;
              }
            });
            const productTypeIds: string[] = flashSaleProductInRedisOm.map(
              (e: any) => String(e.productTypeId)
            );
            listQuery = listQuery.and("ids").containOneOf(...productTypeIds);
            countQuery = countQuery.and("ids").containOneOf(...productTypeIds);
          } else {
            return {
              code: 0,
              message: "Hiện tại đã hết thời gian flash sale",
              data: [],
              count: 0,
            };
          }
        }
        if (keyword) {
          await productTypeService.addSearchHistory(customerId, keyword);
          const { ids, total } = await productHelper.searchProductTypeByKeyword(
            {
              searchText: keyword,
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
        if (sort) {
          switch (sort) {
            case "sell": {
              sortQuery.field = "purchased";
              if (typeSort) {
                sortQuery.sort = typeSort;
              } else {
                sortQuery.sort = "DESC";
              }
              break;
            }
            case "price": {
              sortQuery.field = "paymentCash";
              if (typeSort) {
                sortQuery.sort = typeSort;
              } else {
                sortQuery.sort = "ASC";
              }
              break;
            }
            case "random": {
              sortQuery.field = "randomNumber";
              sortQuery.sort = "ASC";
              break;
            }
            case "new": {
              sortQuery.field = "id";
              sortQuery.sort = "DESC";
              break;
            }
          }
        }
        if (isSuggest == "true") {
          sortQuery.field = "randomNumber";
          sortQuery.sort = "ASC";
        }
        if (keyword) {
          results = await Promise.all([
            listQuery.return.sortBy(sortQuery.field, sortQuery.sort).all(),
            totalQuerySearch,
          ]);
        } else {
          results = await Promise.all([
            listQuery.return
              .sortBy(sortQuery.field, sortQuery.sort)
              .page(skip, limit),
            countQuery.return.count(),
          ]);
        }
        let total = results[1];
        if (results[0].length > 0) {
          if (flashSaleProductInRedisOm.length === 0) {
            const productTypeIdsResult: number[] = results[0].map(
              (e: any) => e.id
            );
            flashSaleProductInRedisOm =
              await flashSaleProductService.getFlashSaleInfoOfProductTypeIds(
                productTypeIdsResult
              );
          }

          let listProduct = results[0].map((e: any) => {
            try {
              const productInfo = JSON.parse(e.fullProductTypeInfoRef as any);
              return productInfo;
            } catch (error) {
              return e;
            }
          });
          if (keyword) {
            if (totalQuerySearch > 0) {
              listProduct = listProduct.sort(
                (a: any, b: any) =>
                  idsQuerySearch.indexOf(a.id) - idsQuerySearch.indexOf(b.id)
              );
            }
          }

          if (flashSaleProductInRedisOm.length > 0 && listProduct.length > 0) {
            const productTypeIds = listProduct.map((e: any) => e.id);
            const flashSaleProducts = flashSaleProductInRedisOm.filter(
              (e: any) => productTypeIds.includes(e.productTypeId)
            );
            listProduct = listProduct.map((e: any) => {
              const flashSaleProduct = flashSaleProducts.find(
                (m: any) => m.productTypeId == e.id
              );
              if (flashSaleProduct) {
                e.flashSalePrice = flashSaleProduct.salePrice;
                e.totalQuantitySale = flashSaleProduct.quantity;
              }
              return e;
            });
            // Sort results by flashSaleVouchersInRedisOm
            // Create a mapping from id to index for array a
            const aMap = new Map();
            flashSaleProducts.forEach((item: any, index: any) => {
              aMap.set(item.productTypeId, index);
            });

            // Sort array b based on the mapping from array a
            listProduct = listProduct.sort((item1: any, item2: any) => {
              const index1 = aMap.get(item1.id);
              const index2 = aMap.get(item2.id);
              return index1 - index2;
            });
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
