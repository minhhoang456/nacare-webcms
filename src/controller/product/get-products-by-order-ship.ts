import { prismaClient } from "@root/src/utils/prisma";
import ono from "@jsdevtools/ono";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import customerMiddleware from "@root/src/middleware/customer";
import redis from "@root/src/utils/redis";
import { productTypeService } from "@root/src/services";

async function getFromCache(key: string) {
  const cachedData = await redis.get(key);
  return cachedData ? JSON.parse(cachedData) : null;
}

async function setToCache(
  key: string,
  data: any,
  expirationInSeconds: number = 3600
) {
  await redis.set(key, JSON.stringify(data), "EX", expirationInSeconds);
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/get-products-by-order-ship`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["Product-Order"],
      body: z.object({
        orderShipId: z.number(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { orderShipId } = req.body;
        let customerId = req.customerId;

        const cacheKey = `customer:${customerId}:orderships`;
        let customerOrderShips: any = await getFromCache(cacheKey);

        if (!customerOrderShips) {
          customerOrderShips = await prismaClient.ordership.findMany({
            where: {
              customerId,
            },
            select: {
              id: true,
              customerId: true,
              orderItemInfos: true,
              storeInfo: true,
              note: true,
              storeId: true,
            },
          });

          // Cache the customer's orderShips
          await setToCache(cacheKey, customerOrderShips);
        }

        let orderShipInfo = customerOrderShips.find(
          (ship: any) => ship.id === orderShipId
        );

        if (!orderShipInfo) {
          throw ono("e_not_found_order_ship");
        }

        const storeCacheKey = `store:${orderShipInfo.storeId}`;
        let storeDetails = await getFromCache(storeCacheKey);

        if (!storeDetails) {
          storeDetails = await prismaClient.store.findUnique({
            where: { id: orderShipInfo.storeId },
            select: {
              gpsLocation: true,
              address: true,
              wardId: true,
              districtId: true,
              provinceId: true,
            },
          });

          if (storeDetails) {
            await setToCache(storeCacheKey, storeDetails);
          }
        }

        // Merge storeDetails với storeInfo
        orderShipInfo.storeInfo = {
          ...orderShipInfo.storeInfo,
          ...storeDetails,
        };

        let productId: any[] = [];
        let productAmount: any = {};
        orderShipInfo.orderItemInfos.map((e: any) => {
          productId.push(e.typeId);
          productAmount[e.typeId] = e.quantity;
          if (e.toppings) {
            productAmount[e.typeId] = {
              quantity: e.quantity,
              toppings: e.toppings,
            };
          }
        });

        // Lấy tất cả product từ cache một lần
        const productCacheKeys = productId.map(id => `product:${id}`);
        const cachedProducts = await redis.mget(productCacheKeys);

        // Tạo map để lưu product
        const productMap = new Map();
        const productsToFetch: any = [];

        // Xử lý cached products và tìm ra những product cần fetch
        cachedProducts.forEach((cachedProduct, index) => {
          if (cachedProduct) {
            productMap.set(productId[index], JSON.parse(cachedProduct));
          } else {
            productsToFetch.push(productId[index]);
          }
        });

        // Fetch những product chưa có trong cache
        if (productsToFetch.length > 0) {
          const fetchedProducts = await prismaClient.product.findMany({
            where: {
              id: {
                in: productsToFetch
              }
            }
          });

          // Cache và thêm vào map
          const cachePipeline = redis.pipeline();
          fetchedProducts.forEach(product => {
            productMap.set(product.id, product);
            cachePipeline.set(
              `product:${product.id}`,
              JSON.stringify(product),
              'EX',
              3600
            );
          });
          await cachePipeline.exec();
        }

        // Lấy unique productTypeIds để fetch một lần
        const productTypeIds = [...new Set(
          Array.from(productMap.values()).map(p => p.productTypeId)
        )];

        // Fetch tất cả productType info một lần
        const productTypeInfos = await Promise.all(
          productTypeIds.map(typeId =>
            productTypeService.getFullProductTypeInfo(typeId)
          )
        );

        // Tạo map để truy xuất nhanh productType info
        const productTypeInfoMap = new Map(
          productTypeInfos.map(info => [info.productTypeInfo.id, info])
        );

        let productInfo = await Promise.all(
          productId.map(async (id) => {
            const product = productMap.get(id);
            if (!product) return null;

            const productTypeInfo = productTypeInfoMap.get(product.productTypeId);
            if (!productTypeInfo) return null;

            const productInfo = productTypeInfo.productInfos.find(
              (p: any) => p.id === product.id
            );

            // Lọc ra attributeValueInfos của sản phẩm hiện tại
            const attrValueInfos = productTypeInfo.productAttributeValueInfos
              .filter((p: any) => p.productId === product.id)
              .map((p: any) => {
                return productTypeInfo.attributeValueInfos.find(
                  (av: any) => av.id === p.attributeValueId
                );
              })
              .filter(Boolean);

            // Lấy attributeInfos tương ứng
            const attrIds = attrValueInfos.map((av: any) => av.attributeId);
            const attrInfos = productTypeInfo.attributeInfos.filter(
              (a: any) => attrIds.includes(a.id)
            );

            return {
              ...product,
              attributeValueInfos: attrValueInfos,
              attributeInfos: attrInfos,
              total: productInfo?.total || 0
            };
          })
        );

        productInfo = productInfo.filter((p) => p !== null);

        productInfo.forEach((e: any) => {
          const productData = productAmount[e.id];
          if (typeof productData === "object") {
            e.quantity = productData.quantity;
          } else {
            e.quantity = productData;
          }
        });

        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            storeInfo: orderShipInfo.storeInfo,
            productInfo,
            partnerId: productInfo.find((e: any) => e.partnerId !== null)
              ?.partnerId,
            note: orderShipInfo.note
          },
        });
      } catch (error: any) {
        console.log(error);
        switch (error.message) {
          case "e_not_found_order_ship":
            res.status(404).send({
              code: -1,
              message: "Không tìm thấy đơn hàng!",
            });
            break;
          default:
            res.status(500).send({
              code: -1,
              message: "Hệ thống bận!",
            });
        }
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
