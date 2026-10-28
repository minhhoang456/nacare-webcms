import customerMiddleware from "@root/src/middleware/customer";
import { productTypeService } from "@root/src/services";
import { pagination } from "@root/src/types/pagination";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-blocks-with-product-type`,
    preHandler: [customerMiddleware as any],

    // Define your schema
    schema: {
      tags: ['Block'],
      summary: 'Block - Lấy danh sách block kèm voucher',
      description: 'Lấy danh sách block kèm voucher',
      querystring: pagination.extend({
        blockId: z
          .string()
          .optional()
          .describe('Nhập id block để lấy thông tin liên quan')
          .transform((value) => {
            if (typeof value === 'string') {
              const numberValue = parseFloat(value);
              if (!isNaN(numberValue)) {
                return numberValue;
              }
            }
            return value;
          }),
        isIntegration: z
          .union([z.number(), z.string()])
          .default(0)
          .describe('Lấy data cho third party')
          .transform((value) => {
            if (typeof value === 'string') {
              const numberValue = parseFloat(value);
              if (!isNaN(numberValue)) {
                return !!numberValue;
              }
            }
            return !!value;
          }),
        isTest: z.string().optional(),
        sort: z.enum(['sell', 'location']).optional(),
        typeSort: z.enum(['ASC', 'DESC']).optional(),
        latitude: z.number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0).optional(),
        longitude: z.number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0).optional(),
        distance: z.number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0).optional(),
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { blockId, isIntegration, skip, limit, isTest, sort, typeSort, latitude, longitude, distance } = req.query;
        if (isTest === 'true') {
          return res.send({ code: 0, message: 'Success', data: [] });
        }
        const customerId: number = req.customerId;

        if (distance && (distance < 0)) {
          return res.send({
            code: -1,
            message: 'Khoảng cách phải lớn hơn 0'
          });
        }

        let blocks = await productTypeService.getBlockWithProductTypeV2({
          customerId,
          blockId,
          isIntegration,
          skip,
          limit,
          sort,
          typeSort,
          latitude,
          longitude,
          distance
        });
        blocks = blocks.filter((obj: any) =>
          Object.prototype.hasOwnProperty.call(obj, 'products')
        );
        return res.send({
          code: 0,
          message: 'Success',
          data: blocks,
        });
      } catch (error: any) {
        switch (error.message) {
          case 'block_not_exits': {
            return res.send({
              code: 404,
              message: 'Không tìm thấy block',
            });
          }
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

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
