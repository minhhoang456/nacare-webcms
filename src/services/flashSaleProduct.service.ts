import { Repository, Schema } from "redis-om";
import redis from "../utils/redis";
import redisClientOm from "../utils/redisOm";
import ConfigSystem from "@src/config/config";
import { prismaClient } from "../utils/prisma";
import moment from "moment";
import { FlashSaleProductDetail } from "@prisma/client";
import itemService from "./item.service";

type FlashSaleProductEntityOm = {
  id: number;
  productId: number;
  flashSaleProductId: number;
  productTypeId: number;
  productTypeIds: string[];
  startTime: number;
  endTime: number;
  sequence: number;
  fullFlashSaleInfo: string;
  productIds: string[];
};

export const flashSaleProductService = {
  bootstrap: async () => {
    await flashSaleProductService.initIndexSearchFlashSale();
  },
  async initIndexSearchFlashSale() {
    redis
      .set(
        "INIT_INDEX_SEARCH_FLASHSALE_PRODUCT",
        "LOCK",
        "EX",
        24 * 60 * 60,
        "NX"
      )
      .then(async (result) => {
        if (result === "OK") {
          try {
            const repositoryFlashsale = this.getRepositoryRedisOm();
            try {
              await repositoryFlashsale.dropIndex();
            } catch (err) {
              console.log("🚀 ~ initIndexSearchVoucher ~ err:", err);
            }
            await repositoryFlashsale.createIndex();
          } catch (error) {
            console.log("🚀 ~ initIndexSearchVoucher ~ error:", error);
          }
        }
      })
      .catch((err) => {
        console.log("🚀 ~ initIndexSearchVoucher ~ err:", err);
      });
  },
  runCronjob30Minutes: async () => {
    try {
      await flashSaleProductService.refreshListFlashSaleForRedisOm();
    } catch (err) {
      console.log("🚀 ~ runCronjob30Minutes: ~ err:", err);
    }
  },

  refreshListFlashSaleForRedisOm: async () => {
    try {
      const repositoryFlashSale =
        flashSaleProductService.getRepositoryRedisOm();
      const listKeyFlashSale = await redisClientOm.keys(
        `*${process.env.REDIS_PREFIX}:flashsale_redisom*`
      );
      if (listKeyFlashSale.length > 0) {
        await redisClientOm.del(listKeyFlashSale);
      }
      const startOfDay = moment().startOf("day").valueOf();
      const listFlashSale = await prismaClient.flashSaleProductDetail.findMany({
        where: {
          statusOfParent: "active",
          isActive: true,
          startTime: {
            gte: startOfDay,
          },
        },
      });
      if (listFlashSale.length === 0) {
        return;
      }
      for (let i = 0; i < listFlashSale.length; i++) {
        const e = listFlashSale[i];
        const flashSaleEntity: FlashSaleProductEntityOm = {
          id: e.id,
          productIds: [e.productId.toString()],
          productId: e.productId,
          productTypeId: e.productTypeId,
          productTypeIds: [e.productTypeId.toString()],
          flashSaleProductId: e.flashSaleProductId,
          startTime: Number(e.startTime),
          endTime: Number(e.endTime),
          sequence: e.sequence || 0,
          fullFlashSaleInfo: JSON.stringify(e),
        };
        await repositoryFlashSale.save(String(e.id), flashSaleEntity);
      }
    } catch (err) {
      console.log("🚀 ~ refreshListFlashSaleForRedisOm: ~ err:", err);
    }
  },

  getRepositoryRedisOm() {
    const flashSaleRepository = new Repository(
      this.getSchemaRedisOm(),
      redisClientOm
    );
    return flashSaleRepository;
  },

  getSchemaRedisOm() {
    const flashsaleSchema = new Schema(
      `${ConfigSystem.REDISEARCH_CONFIG.prefix}:flashsale_product_redisom`,
      {
        id: { type: "number", sortable: true },
        productId: { type: "number" },
        productIds: { type: "string[]" },
        productTypeId: { type: "number" },
        productTypeIds: { type: "string[]" },
        flashSaleProductId: { type: "number" },
        startTime: { type: "number", sortable: true },
        endTime: { type: "number", sortable: true },
        sequence: { type: "number", sortable: true },
        fullFlashSaleInfo: { type: "text" },
      },
      {
        indexName: `${process.env.REDIS_PREFIX}:flashsale_product_search`,
        dataStructure: "JSON",
      }
    );
    return flashsaleSchema;
  },

  removeCacheFlashSaleProduct: async (productIds: number[]) => {
    const keyFlashSaleProducts = productIds.map((e) =>
      flashSaleProductService.getKeyFlashSaleProduct(e)
    );
    await redis.del(...keyFlashSaleProducts);
  },

  getKeyFlashSaleProduct: (productId: number): string => {
    return `flashSaleProduct:${productId}`;
  },

  getFlashSaleInfoOfProductTypeIds: async (productTypeIds: number[]) => {
    const now = new Date().getTime();
    const repositoryRedisOMFlashSale =
      flashSaleProductService.getRepositoryRedisOm();
    const listFlashSaleInRedisOm = await repositoryRedisOMFlashSale
      .search()
      .where("productTypeIds")
      .containOneOf(...productTypeIds.map((id) => id.toString()))
      .and("startTime")
      .lte(now)
      .and("endTime")
      .gte(now)
      .sortBy("sequence", "ASC")
      .returnAll();
    if (listFlashSaleInRedisOm.length > 0) {
      const flashSaleProductsInRedisOm = listFlashSaleInRedisOm.map(
        (e: any) => {
          try {
            return JSON.parse(e.fullFlashSaleInfo as any);
          } catch (error) {
            return e;
          }
        }
      );
      return flashSaleProductsInRedisOm;
    } else {
      return [];
    }
  },

  getFlashSaleProductInfo: async (
    flashSaleProductId: number
  ): Promise<FlashSaleProductDetail | null> => {
    const flashSaleProductInRedis = await redis.get(
      `flashSaleProduct:${flashSaleProductId}`
    );
    if (flashSaleProductInRedis) {
      return JSON.parse(flashSaleProductInRedis);
    }
    const flashSaleProductInDB =
      await prismaClient.flashSaleProductDetail.findFirst({
        where: {
          id: flashSaleProductId,
        },
      });
    if (!flashSaleProductInDB) {
      return null;
    }
    redis
      .set(
        `flashSaleProduct:${flashSaleProductId}`,
        JSON.stringify(flashSaleProductInDB),
        "EX",
        120
      )
      .then(() => { });
    return flashSaleProductInDB;
  },

  getFlashSaleProductInfoByProductIds: async (
    productIds: number[]
  ): Promise<FlashSaleProductDetail[]> => {
    const now = new Date().getTime();
    const repositoryRedisOMFlashSale =
      flashSaleProductService.getRepositoryRedisOm();
    const listFlashSaleInRedisOm = await repositoryRedisOMFlashSale
      .search()
      .where("productIds")
      .containOneOf(...productIds.map((id) => id.toString()))
      .and("startTime")
      .lte(now)
      .and("endTime")
      .gte(now)
      .sortBy("sequence", "ASC")
      .returnAll();
    if (listFlashSaleInRedisOm.length > 0) {
      const flashSaleProductsInRedisOm = listFlashSaleInRedisOm.map(
        (e: any) => {
          try {
            return JSON.parse(e.fullFlashSaleInfo as any);
          } catch (error) {
            return e;
          }
        }
      );
      return flashSaleProductsInRedisOm;
    } else {
      return [];
    }
  },

  completeHoldingFlashSaleProduct: async (orderId: number) => {
    const orderItem = await prismaClient.orderitem.findFirst({
      where: {
        orderId,
      },
    });
    if (!orderItem || !orderItem.flashSaleProductId) {
      return;
    }
    const flashSaleInfo = await prismaClient.flashSaleProductDetail.findFirst({
      where: {
        id: orderItem.flashSaleProductId,
      },
    });
    if (!flashSaleInfo) {
      return;
    }
    const itemId = flashSaleInfo.itemId;
    const quantity = orderItem.quantity;
    if (itemId && quantity) {
      await itemService.completeHoldingByItemId(itemId, quantity);
    }
  },
};
export default flashSaleProductService;
