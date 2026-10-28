import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import flashSaleProductService from "@root/src/services/flashSaleProduct.service";
import { itemService } from "@root/src/services/item.service";
import { Prisma, prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import moment from "moment";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/create`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      tags: ["flash-sale", "product"],
      summary: "Tạo mới flash sale sản phẩm",
      description: "Tạo mới flash sale sản phẩm",
      body: z.object({
        name: z.string().describe("Tên chương trình khuyến mãi"),
        description: z
          .string()
          .describe("Mô tả chương trình khuyến mãi")
          .optional()
          .nullable(),
        dayFlashSale: z
          .string()
          .describe("Ngày khuyến mãi")
          .regex(
            /^\d{4}-\d{2}-\d{2}$/,
            "Vui lòng nhập đúng định dạng yyyy-mm-dd"
          ),
        timeFrameId: z.number().describe("ID của time frame"),
        isActive: z.boolean().describe("Trạng thái chương trình khuyến mãi"),
        products: z.array(
          z.object({
            productId: z.number().describe("ID của sản phẩm"),
            productTypeId: z.number().describe("ID của loại sản phẩm"),
            normalPrice: z.number().describe("Giá gốc"),
            salePrice: z
              .number()
              .nullable()
              .transform((val) => val ?? 0)
              .describe("Giá khuyến mãi"),
            quantity: z
              .number()
              .int()
              .describe("Số lượng voucher")
              .min(1, "Số lượng voucher phải lớn hơn 0"),
            sequence: z
              .number()
              .int()
              .describe("Vị trí sản phẩm trong chương trình khuyến mãi"),
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
          name,
          description,
          dayFlashSale,
          timeFrameId,
          isActive,
          products,
        } = req.body;
        // Check dayFlashSale > now
        const now = new Date().getTime();
        const dayFlashSaleTime = moment(dayFlashSale).endOf("day").valueOf();
        if (dayFlashSaleTime < now) {
          return res.status(400).send({
            code: 5,
            message: "Ngày khuyến mãi phải lớn hơn ngày hiện tại",
          });
        }
        const checkExist = await prismaClient.flashSaleProduct.findFirst({
          where: {
            dayFlashSale: dayFlashSale,
            timeFrameFlashSaleId: timeFrameId,
          },
        });
        if (checkExist) {
          return res.status(400).send({
            code: 1,
            message: `Khung giờ từ ${moment(
              Number(checkExist.startTime)
            ).hour()} giờ đến ${moment(
              Number(checkExist.endTime)
            ).hour()} giờ trong ngày ${dayFlashSale} đã được tạo. Vui lòng chọn khung giờ khác`,
          });
        }
        const productIds = products.map((item) => item.productId);
        const productsInDatabase = await prismaClient.product.findMany({
          where: {
            id: {
              in: productIds,
            },
          },
        });
        if (productsInDatabase.length !== productIds.length) {
          return res.status(400).send({
            code: 2,
            message: "Sản phẩm không tồn tại, vui lòng kiểm tra lại",
          });
        }
        const timeFrameInfo = await prismaClient.timeFrameFlashSale.findUnique({
          where: {
            id: timeFrameId,
          },
        });
        if (!timeFrameInfo) {
          return res.status(400).send({
            code: 3,
            message: "Khung thời gian không tồn tại, vui lòng kiểm tra lại",
          });
        }
        const startTime = moment(dayFlashSale)
          .add(timeFrameInfo.startHour, "hours")
          .startOf("hours")
          .valueOf();
        const endTime = moment(dayFlashSale)
          .add(timeFrameInfo.endHour, "hours")
          .endOf("hours")
          .valueOf();
        await prismaClient.$transaction(async (transactionDB) => {
          const flashSale = await transactionDB.flashSaleProduct.create({
            data: {
              name: name,
              description: description || "",
              dayFlashSale: dayFlashSale,
              timeFrameFlashSaleId: timeFrameId,
              isActive: isActive,
              startTime: startTime,
              endTime: endTime,
            },
          });
          const items: Prisma.itemCreateManyInput[] = products.map((e) => {
            return {
              total: e.quantity,
              type: "flashsale",
              typeId: flashSale.id,
              useQuantity: true,
            };
          });
          await transactionDB.item.createMany({
            data: items,
          });
          const itemsCreated = await transactionDB.item.findMany({
            where: {
              type: "flashsale",
              typeId: flashSale.id,
            },
          });
          itemService
            .setCacheForItems(itemsCreated)
            .then(() => {})
            .catch((err) => console.log(err));
          const flashSaleProductDetails: Prisma.FlashSaleProductDetailCreateManyInput[] =
            [];
          products.forEach((e) => {
            const productInDataBase = productsInDatabase.find(
              (product) => product.id === e.productId
            );
            if (!productInDataBase) {
              return;
            }
            const item = itemsCreated.find((item) => item.total === e.quantity);
            if (item) {
              itemsCreated.splice(itemsCreated.indexOf(item), 1);
            }
            flashSaleProductDetails.push({
              partnerId: productInDataBase.partnerId as number,
              productTypeId: e.productTypeId,
              productId: e.productId,
              flashSaleProductId: flashSale.id,
              normalPrice: e.normalPrice,
              salePrice: e.salePrice,
              quantity: e.quantity,
              sequence: e.sequence,
              timeFrameFlashSaleId: timeFrameId,
              startTime,
              endTime,
              itemId: item ? item.id : null,
              isActive: true,
            });
          });
          await transactionDB.flashSaleProductDetail.createMany({
            skipDuplicates: true,
            data: flashSaleProductDetails,
          });
        });
        // Remove cache flashsale
        flashSaleProductService.refreshListFlashSaleForRedisOm().then(() => {});
        flashSaleProductService
          .removeCacheFlashSaleProduct(productIds)
          .then(() => {});
        return res.status(200).send({
          code: 0,
          message: "Tạo chương trình khuyến mãi thành công",
        });
      } catch (err) {
        console.log("🚀 ~ handler: ~ err:", err);
        return res.status(500).send({
          code: 4,
          message: "Có lỗi xảy ra, vui lòng thử lại sau",
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
