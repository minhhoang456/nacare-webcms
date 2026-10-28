import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prismaClient } from '@root/src/utils/prisma';
import _ from 'lodash';
import redis from '@root/src/utils/redis';
import Item from '@src/services/item.service';
import flashSaleVoucherService from '../../../services/flashSaleVoucher.service';
import userMidlleware from '@root/src/middleware/user';
import actionLogMidlleware from '@root/src/middleware/actionLog';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/update-flashsale`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      summary: 'Flash Sale - Cập nhật chương trình khuyến mãi',
      description: 'Cập nhật chương trình khuyến mãi',
      body: z.object({
        flashSaleVoucherId: z.number().describe('ID của flash sale'),
        name: z.string().describe('Tên chương trình khuyến mãi').optional(),
        description: z
          .string()
          .describe('Mô tả chương trình khuyến mãi')
          .optional()
          .nullable(),
        isActive: z
          .boolean()
          .describe('Trạng thái chương trình khuyến mãi')
          .optional(),
        flashSaleVoucherDetais: z.array(
          z.object({
            id: z.number().describe('ID của chi tiết flash sale'),
            voucherId: z.number().describe('ID của voucher'),
            isActive: z
              .boolean()
              .describe('Trạng thái chi tiết flash sale')
              .optional(),
            normalPrice: z.number().describe('Giá gốc').optional(),
            salePrice: z.number().describe('Giá khuyến mãi').optional(),
            quantity: z
              .number()
              .int()
              .describe('Số lượng voucher')
              .min(1, 'Số lượng voucher phải lớn hơn 0'),
            sequence: z
              .number()
              .describe('Thứ tự hiển thị')
              .optional()
              .default(0),
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
          flashSaleVoucherId,
          name,
          isActive,
          description,
          flashSaleVoucherDetais,
        } = req.body;
        const flashSaleVoucherInfo =
          await prismaClient.flashSaleVoucher.findUnique({
            where: {
              id: flashSaleVoucherId,
            },
          });
        if (!flashSaleVoucherInfo) {
          return res.status(404).send({
            code: 1,
            message: 'Không tìm thấy flash sale',
          });
        }
        const flashSaleVoucherDetailsInDB =
          await prismaClient.flashSaleVoucherDetail.findMany({
            where: {
              flashSaleVoucherId,
            },
          });
        const flashSaleVoucherDetailIdsInDb = flashSaleVoucherDetailsInDB.map(
          (e) => e.id
        );
        const flashSaleVoucherDetailIdsInRequest = flashSaleVoucherDetais.map(
          (e) => e.id
        );
        const flashSaleVoucherDetailIdsUpdateToDb = _.intersection(
          flashSaleVoucherDetailIdsInDb,
          flashSaleVoucherDetailIdsInRequest
        );
        const flashSaleVoucherDetailIdsInsertToDb = _.difference(
          flashSaleVoucherDetailIdsInRequest,
          flashSaleVoucherDetailIdsUpdateToDb
        );
        const flashSaleVoucherDetailIdsDeactiveToDb = _.difference(
          flashSaleVoucherDetailIdsInDb,
          flashSaleVoucherDetailIdsUpdateToDb
        );
        const flashSaleVoucherDetailsUpdate = flashSaleVoucherDetais.filter(
          (e) => {
            if (flashSaleVoucherDetailIdsUpdateToDb.some((a) => a === e.id)) {
              return true;
            } else {
              return false;
            }
          }
        );
        const flashSaleVoucherDetailsInsert = flashSaleVoucherDetais.filter(
          (e) => {
            if (flashSaleVoucherDetailIdsInsertToDb.some((a) => a === e.id)) {
              return true;
            } else {
              return false;
            }
          }
        );
        const flashSaleVoucherDetailsDeactive =
          flashSaleVoucherDetailsInDB.filter((e) => {
            if (flashSaleVoucherDetailIdsDeactiveToDb.some((a) => a === e.id)) {
              return true;
            } else {
              return false;
            }
          });
        await prismaClient.flashSaleVoucher.update({
          where: {
            id: flashSaleVoucherId,
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
              in: flashSaleVoucherDetailsInDB.map((e) => Number(e.itemId || 0)),
            },
          },
        });
        // update flash sale detail
        const process = [];
        for (let i = 0; i < flashSaleVoucherDetailsUpdate.length; i++) {
          const e = flashSaleVoucherDetailsUpdate[i];
          const flashSaleVoucherDetailInfoOld =
            flashSaleVoucherDetailsInDB.find((a) => a.id === e.id);
          let itemInfo = itemInfos.find(
            (a) => a.id === flashSaleVoucherDetailInfoOld?.itemId
          );
          if (!itemInfo) {
            itemInfo = await prismaClient.item.create({
              data: {
                total: e.quantity,
                type: 'flashsale',
                typeId: flashSaleVoucherInfo.id,
                useQuantity: true,
              },
            });
          } else {
            const keyItem = Item.getItemHashKey(itemInfo.id);
            redis.hmset(keyItem, 'total', e.quantity);
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
            prismaClient.flashSaleVoucherDetail.update({
              where: {
                id: e.id,
              },
              data: {
                voucherId: e.voucherId,
                isActive: isActive,
                normalPrice: e.normalPrice,
                salePrice: e.salePrice,
                quantity: e.quantity,
                sequence: e.sequence,
                statusOfParent: isActive ? 'active' : 'inactive',
              },
            })
          );
        }
        for (let i = 0; i < flashSaleVoucherDetailsInsert.length; i++) {
          const e = flashSaleVoucherDetailsInsert[i];
          const itemInfo = await prismaClient.item.create({
            data: {
              total: e.quantity,
              type: 'flashsale',
              typeId: flashSaleVoucherInfo.id,
              useQuantity: true,
            },
          });
          process.push(
            prismaClient.flashSaleVoucherDetail.create({
              data: {
                flashSaleVoucherId,
                voucherId: e.voucherId,
                isActive: e.isActive,
                normalPrice: e.normalPrice,
                salePrice: e.salePrice,
                quantity: e.quantity,
                sequence: e.sequence,
                itemId: itemInfo.id,
                statusOfParent: isActive ? 'active' : 'inactive',
                startTime: flashSaleVoucherInfo.startTime,
                endTime: flashSaleVoucherInfo.endTime,
                timeFrameFlashSaleId: flashSaleVoucherInfo.timeFrameFlashSaleId,
              },
            })
          );
        }
        for (let i = 0; i < flashSaleVoucherDetailsDeactive.length; i++) {
          const e = flashSaleVoucherDetailsDeactive[i];
          process.push(
            prismaClient.flashSaleVoucherDetail.delete({
              where: {
                id: e.id,
              },
            })
          );
        }
        if (process.length) {
          await prismaClient.$transaction(process);
        }
        flashSaleVoucherService.refreshListFlashSaleForRedisOm().then(() => {});
        flashSaleVoucherService
          .removeCacheFlashSaleVoucher(
            flashSaleVoucherDetais.map((e) => e.voucherId)
          )
          .then(() => {});
        return res.send({
          code: 0,
          message: 'Cập nhật thành công',
        });
      } catch (err) {
        console.log('🚀 ~ handler: ~ err:', err);
        return res.status(500).send({
          code: 1,
          message: 'Có lỗi xảy ra',
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
