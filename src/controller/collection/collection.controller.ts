import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { pagination } from '@root/src/types/pagination';
import { prismaClient as prisma } from '@root/src/utils/prisma';
import { Collection, voucher } from '@prisma/client';
import { z } from 'zod';
import { CollectionService } from '@root/src/services';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-list-collections`,
    schema: {
      tags: ['Collection'],
      summary: 'Collection - Lấy danh sách bộ sưu tập',
      description: 'Lấy danh sách bộ sưu tập',
      querystring: pagination,
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { skip, limit, isTest } = req.query;
        if (isTest === 'true') {
          return res.send({ code: 0, message: 'Thành công', data: [] });
        }
        // const repositoryRedisOMVoucher = voucherService.getRepositoryRedisOm()
        const { collectionTabs, collections, total } =
          await CollectionService.getCollections(skip, limit);
        const promises: any = [];
        collections.forEach((collection: any) => {
          if (
            collection.voucherIds === null ||
            //@ts-ignore
            collection.voucherIds.length === 0
          )
            return;
          // promises.push(
          //   repositoryRedisOMVoucher
          //     .search()
          //     .and('ids')
          //     .containOneOf(
          //       //@ts-ignore
          //       ...collection.voucherIds.map((id) => id.toString())
          //     )
          //     .count()
          // );
        });
        if (promises.length > 0) {
          const results = await Promise.all(promises);
          results.forEach((result: any, index: number) => {
            if (result.length === 0) return;
            //@ts-ignore
            collections[index].voucherLength = result;
          });
        }
        return res.send({
          code: 0,
          message: 'Success',
          collectionTabs,
          data: collections,
          total,
        });
      } catch (error: any) {
        switch (error.message) {
          default: {
            console.log(error);
            return res.send({
              code: -1,
              message: 'Hệ thống đang bận vui lòng thử lại sau !',
            });
          }
        }
      }
    },
  });
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-vouchers-in-collection`,
    schema: {
      tags: ['Collection'],
      summary: 'Collection - Lấy danh sách voucher trong bộ sưu tập',
      description: 'Lấy danh sách voucher trong bộ sưu tập',
      querystring: pagination.extend({
        collectionId: z.union([z.number(), z.string()]).optional(),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { collectionId, skip, limit } = req.query;
        const collections: Collection =
          await prisma.collection.findFirstOrThrow({
            where: {
              id: Number(collectionId),
              isActive: true,
            },
          });
        const vouchers: voucher[] = await prisma.voucher.findMany({
          where: {
            id: { in: collections.voucherIds as number[] },
          },
          skip,
          take: limit,
        });
        return res.send({
          code: 0,
          message: 'Success',
          data: vouchers,
        });
      } catch (error: any) {
        switch (error.message) {
          default: {
            console.log(error);
            return res.send({
              code: -1,
              message: 'Hệ thống đang bận vui lòng thử lại sau !',
            });
          }
        }
      }
    },
  });
};
