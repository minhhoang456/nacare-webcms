import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prismaClient, Prisma } from '@root/src/utils/prisma';
import moment from 'moment';
import { item } from '@prisma/client';
import itemService from '../../../services/item.service';
import { flashSaleVoucherService } from '@root/src/services';
import userMidlleware from '@root/src/middleware/user';
import actionLogMidlleware from '@root/src/middleware/actionLog';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/create-flashsale`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      summary: 'Flash Sale - Tạo chương trình khuyến mãi',
      description: 'Tạo chương trình khuyến mãi',
      body: z.object({
        name: z.string().describe('Tên chương trình khuyến mãi'),
        description: z
          .string()
          .describe('Mô tả chương trình khuyến mãi')
          .optional()
          .nullable(),
        dayFlashSale: z
          .string()
          .describe('Ngày khuyến mãi')
          .regex(
            /^\d{4}-\d{2}-\d{2}$/,
            'Vui lòng nhập đúng định dạng yyyy-mm-dd'
          ),
        timeFrameId: z.number().describe('ID của time frame'),
        isActive: z.boolean().describe('Trạng thái chương trình khuyến mãi'),
        voucherInfos: z.array(
          z.object({
            voucherId: z.number().describe('ID của voucher'),
            normalPrice: z.number().describe('Giá gốc'),
            salePrice: z
              .number()
              .nullable()
              .transform((val) => val ?? 0)
              .describe('Giá khuyến mãi'),
            quantity: z
              .number()
              .int()
              .describe('Số lượng voucher')
              .min(1, 'Số lượng voucher phải lớn hơn 0'),
            sequence: z
              .number()
              .describe('Thứ tự hiển thị')
              .optional()
              .default(9999),
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
          voucherInfos,
        } = req.body;
        // Check dayFlashSale > now
        const now = new Date().getTime();
        const dayFlashSaleTime = moment(dayFlashSale).endOf('day').valueOf();
        if (dayFlashSaleTime < now) {
          return res.status(400).send({
            code: 5,
            message: 'Ngày khuyến mãi phải lớn hơn ngày hiện tại',
          });
        }
        const checkExist = await prismaClient.flashSaleVoucher.findFirst({
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
        const voucherIds = voucherInfos.map((item) => item.voucherId);
        const vouchersInDatabase = await prismaClient.voucher.findMany({
          where: {
            id: {
              in: voucherIds,
            },
          },
        });
        if (vouchersInDatabase.length !== voucherIds.length) {
          return res.status(400).send({
            code: 2,
            message: 'Voucher không tồn tại, vui lòng kiểm tra lại',
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
            message: 'Khung thời gian không tồn tại, vui lòng kiểm tra lại',
          });
        }
        const startTime = moment(dayFlashSale)
          .add(timeFrameInfo.startHour, 'hours')
          .startOf('hours')
          .valueOf();
        const endTime = moment(dayFlashSale)
          .add(timeFrameInfo.endHour, 'hours')
          .endOf('hours')
          .valueOf();
        await prismaClient.$transaction(async (transactionDB) => {
          const flashSale = await transactionDB.flashSaleVoucher.create({
            data: {
              name: name,
              description: description,
              dayFlashSale: dayFlashSale,
              timeFrameFlashSaleId: timeFrameId,
              isActive: isActive,
              startTime: startTime,
              endTime: endTime,
            },
          });
          const items: Prisma.itemCreateManyInput[] = voucherInfos.map((e) => {
            return {
              total: e.quantity,
              type: 'flashsale',
              typeId: flashSale.id,
              useQuantity: true,
            };
          });
          await transactionDB.item.createMany({
            skipDuplicates: false,
            data: items,
          });
          const itemsCreated: any = await transactionDB.item.findMany({
            where: {
              type: 'flashsale',
              typeId: flashSale.id,
            },
          });
          itemService
            .setCacheForItems(itemsCreated)
            .then(() => {})
            .catch((err) => console.log(err));
          const flashSaleVoucherDetails: Prisma.FlashSaleVoucherDetailCreateManyInput[] =
            voucherInfos.map((e) => {
              const item = itemsCreated.find(
                (item: item) => item.total === e.quantity
              );
              // Remove item from list
              itemsCreated.splice(itemsCreated.indexOf(item), 1);
              return {
                voucherId: e.voucherId,
                normalPrice: e.normalPrice,
                salePrice: e.salePrice,
                quantity: e.quantity,
                sequence: e.sequence,
                timeFrameFlashSaleId: timeFrameId,
                startTime,
                endTime,
                itemId: item ? item.id : null,
                flashSaleVoucherId: flashSale.id,
                isActive: true,
              };
            });
          await transactionDB.flashSaleVoucherDetail.createMany({
            skipDuplicates: true,
            data: flashSaleVoucherDetails,
          });
        });
        // Remove cache flashsale
        flashSaleVoucherService.refreshListFlashSaleForRedisOm().then(() => {});
        flashSaleVoucherService
          .removeCacheFlashSaleVoucher(voucherIds)
          .then(() => {});
        return res.status(200).send({
          code: 0,
          message: 'Tạo chương trình khuyến mãi thành công',
        });
      } catch (err) {
        console.log('🚀 ~ handler: ~ err:', err);
        return res.status(500).send({
          code: 4,
          message: 'Có lỗi xảy ra, vui lòng thử lại sau',
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
