import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import _ from "lodash";
import { z } from "zod";
import Item from "@src/services/item.service";
import redis from "@root/src/utils/redis";
import flashSaleProductService from "@root/src/services/flashSaleProduct.service";
import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/update`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      summary: "Flash Sale - Cập nhật chương trình khuyến mãi",
      description: "Cập nhật chương trình khuyến mãi",
      body: z.object({
        flashSaleProductId: z.number().describe("ID của flash sale"),
        name: z.string().describe("Tên chương trình khuyến mãi").optional(),
        description: z
          .string()
          .describe("Mô tả chương trình khuyến mãi")
          .optional()
          .nullable(),
        isActive: z
          .boolean()
          .describe("Trạng thái chương trình khuyến mãi")
          .optional(),
        flashSaleProductDetais: z.array(
          z.object({
            flashSaleProductDetailId: z
              .number()
              .describe("ID của chi tiết flash sale"),
            productTypeId: z.number().describe("ID của loại sản phẩm"),
            productId: z.number().describe("ID của sản phẩm"),
            isActive: z
              .boolean()
              .describe("Trạng thái chi tiết flash sale")
              .optional(),
            normalPrice: z.number().describe("Giá gốc"),
            salePrice: z.number().describe("Giá khuyến mãi"),
            quantity: z
              .number()
              .int()
              .describe("Số lượng sản phẩm")
              .min(1, "Số lượng sản phẩm phải lớn hơn 0"),
            sequence: z.number().describe("Vị trí").optional(),
          })
        ),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        const {
          flashSaleProductId,
          name,
          isActive,
          description,
          flashSaleProductDetais,
        } = req.body;
        const flashSaleProductInfo =
          await prismaClient.flashSaleProduct.findUnique({
            where: {
              id: flashSaleProductId,
            },
          });
        if (!flashSaleProductInfo) {
          return res.status(404).send({
            code: 1,
            message: "Không tìm thấy flash sale",
          });
        }
        const productsInDb = await prismaClient.product.findMany({
          where: {
            id: {
              in: flashSaleProductDetais.map((e) => e.productId),
            },
          },
        });
        if (productsInDb.length !== flashSaleProductDetais.length) {
          return res.status(400).send({
            code: 1,
            message: "Sản phẩm không tồn tại",
          });
        }
        const flashSaleProductDetailsInDB =
          await prismaClient.flashSaleProductDetail.findMany({
            where: {
              flashSaleProductId,
            },
          });
        const flashSaleProductDetailIdsInDb = flashSaleProductDetailsInDB.map(
          (e) => e.id
        );
        const flashSaleProductDetailIdsInRequest = flashSaleProductDetais.map(
          (e) => e.flashSaleProductDetailId
        );
        const flashSaleProductDetailIdsUpdateToDb = _.intersection(
          flashSaleProductDetailIdsInDb,
          flashSaleProductDetailIdsInRequest
        );
        const flashSaleProductDetailIdsInsertToDb = _.difference(
          flashSaleProductDetailIdsInRequest,
          flashSaleProductDetailIdsUpdateToDb
        );
        const flashSaleProductDetailIdsDeactiveToDb = _.difference(
          flashSaleProductDetailIdsInDb,
          flashSaleProductDetailIdsUpdateToDb
        );
        const flashSaleProductDetailsUpdate = flashSaleProductDetais.filter(
          (e) => {
            if (
              flashSaleProductDetailIdsUpdateToDb.some(
                (a) => a === e.flashSaleProductDetailId
              )
            ) {
              return true;
            } else {
              return false;
            }
          }
        );
        const flashSaleProductDetailsInsert = flashSaleProductDetais.filter(
          (e) => {
            if (
              flashSaleProductDetailIdsInsertToDb.some(
                (a) => a === e.flashSaleProductDetailId
              )
            ) {
              return true;
            } else {
              return false;
            }
          }
        );
        const flashSaleProductDetailsDeactive =
          flashSaleProductDetailsInDB.filter((e) => {
            if (flashSaleProductDetailIdsDeactiveToDb.some((a) => a === e.id)) {
              return true;
            } else {
              return false;
            }
          });
        await prismaClient.flashSaleProduct.update({
          where: {
            id: flashSaleProductId,
          },
          data: {
            name,
            isActive,
            description,
          },
        });
        const itemInfos = await prismaClient.item.findMany({
          where: {
            id: {
              in: flashSaleProductDetailsInDB.map((e) => Number(e.itemId || 0)),
            },
          },
        });
        // update flash sale detail
        const process = [];
        for (let i = 0; i < flashSaleProductDetailsUpdate.length; i++) {
          const e = flashSaleProductDetailsUpdate[i];
          const flashSaleProductDetailInfoOld =
            flashSaleProductDetailsInDB.find(
              (a) => a.id === e.flashSaleProductDetailId
            );
          let itemInfo = itemInfos.find(
            (a) => a.id === flashSaleProductDetailInfoOld?.itemId
          );
          if (!itemInfo) {
            itemInfo = await prismaClient.item.create({
              data: {
                total: e.quantity,
                type: "flashsale",
                typeId: flashSaleProductInfo.id,
                useQuantity: true,
              },
            });
          } else {
            const keyItem = Item.getItemHashKey(itemInfo.id);
            redis.hmset(keyItem, "total", e.quantity);
            process.push(
              prismaClient.item.update({
                where: {
                  id: itemInfo.id,
                },
                data: {
                  total: e.quantity,
                },
              })
            );
          }
          process.push(
            prismaClient.flashSaleProductDetail.update({
              where: {
                id: e.flashSaleProductDetailId,
              },
              data: {
                productId: e.productId,
                isActive: isActive,
                normalPrice: e.normalPrice,
                salePrice: e.salePrice,
                quantity: e.quantity,
                sequence: e.sequence,
                statusOfParent: isActive ? "active" : "inactive",
              },
            })
          );
        }
        for (let i = 0; i < flashSaleProductDetailsInsert.length; i++) {
          const productInDb = productsInDb.find(
            (a) => a.id === flashSaleProductDetailsInsert[i].productId
          );
          if (!productInDb) {
            continue;
          }
          const e = flashSaleProductDetailsInsert[i];
          const itemInfo = await prismaClient.item.create({
            data: {
              total: e.quantity,
              type: "flashsale",
              typeId: flashSaleProductInfo.id,
              useQuantity: true,
            },
          });
          process.push(
            prismaClient.flashSaleProductDetail.create({
              data: {
                flashSaleProductId,
                productId: e.productId,
                isActive: e.isActive,
                normalPrice: e.normalPrice,
                salePrice: e.salePrice,
                quantity: e.quantity,
                sequence: e.sequence,
                partnerId: productInDb.partnerId as number,
                productTypeId: e.productTypeId,
                itemId: itemInfo.id,
                statusOfParent: isActive ? "active" : "inactive",
                startTime: flashSaleProductInfo.startTime,
                endTime: flashSaleProductInfo.endTime,
                timeFrameFlashSaleId: flashSaleProductInfo.timeFrameFlashSaleId,
              },
            })
          );
        }
        for (let i = 0; i < flashSaleProductDetailsDeactive.length; i++) {
          const e = flashSaleProductDetailsDeactive[i];
          process.push(
            prismaClient.flashSaleProductDetail.delete({
              where: {
                id: e.id,
              },
            })
          );
        }
        if (process.length) {
          await prismaClient.$transaction(process);
        }
        flashSaleProductService.refreshListFlashSaleForRedisOm().then(() => {});
        flashSaleProductService
          .removeCacheFlashSaleProduct(
            flashSaleProductDetais.map((e) => e.productId)
          )
          .then(() => {});
        return res.send({
          code: 0,
          message: "Cập nhật thành công",
        });
      } catch (err) {
        console.log("🚀 ~ handler: ~ err:", err);
        return res.status(500).send({
          code: 1,
          message: "Có lỗi xảy ra",
          err,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
