import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import ProductType from "@src/services/productType.service";
import flashSaleProductService from "../../services/flashSaleProduct.service";
import Item from "@src/services/item.service";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-product-type-info`,
    // Define your schema
    schema: {
      tags: ["producttype"],
      summary: "Get product type info",
      description: "Get product type info",
      // body: z.object({
      // }),
      querystring: z.object({
        productTypeId: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
      }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const { productTypeId } = req.query;
        const data = await ProductType.getFullProductTypeInfo(productTypeId);
        // const productTypeRate = await ProductType.getProductTypeInfoFromDb(productTypeId);
        // if (productTypeRate) {
        //   return productTypeRate
        // }
        const flashSaleProducts =
          await flashSaleProductService.getFlashSaleInfoOfProductTypeIds([
            productTypeId,
          ]);
        if (flashSaleProducts.length > 0) {
          data.productTypeInfo.haveFlashSale = true;
          const itemInfos = await Item.getListItems(
            flashSaleProducts.map((e: any) => e.itemId)
          );
          data.productInfos.forEach((product: any) => {
            const flashSaleProduct = flashSaleProducts.find(
              (e: any) => e.productId == product.id
            );
            if (flashSaleProduct) {
              const itemInfo = itemInfos.find(
                (e: any) => e.id == flashSaleProduct.itemId
              );
              const currentQuantity = itemInfo.total - itemInfo.purchased;
              if (currentQuantity > 0) {
                product.haveFlashSale = true;
                product.flashSalePrice = flashSaleProduct.salePrice;
                product.totalQuantitySale = flashSaleProduct.quantity;
              } else {
                product.haveFlashSale = false;
              }
            }
          });
        } else {
          data.productTypeInfo.haveFlashSale = false;
        }
        return { code: 0, data, message: "Thành công" };
      } catch (error: any) {
        switch (error.code) {
          case "e_product_not_found": {
            return res.send({
              code: 1,
              message: "Không tìm thấy thông tin sản phẩm",
            });
          }
          default: {
            return {
              code: -1,
              message: "Lỗi hệ thống",
              detail: error,
            };
          }
        }
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
