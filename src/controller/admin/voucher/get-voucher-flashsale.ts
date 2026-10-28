import actionLogMidlleware from '@root/src/middleware/actionLog'
import userMidlleware from '@root/src/middleware/user'
import { Prisma, prismaClient } from '@root/src/utils/prisma'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-voucher-flashsale`,
    preHandler: [userMidlleware as any, actionLogMidlleware],
    // Define your schema
    schema: {
      // body: z.object({
      // }),
      querystring: z.object({
        skip: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .optional()
          .describe('Số lượng bỏ qua'),
        limit: z
          .number()
          .or(z.string().regex(/\d+/).transform(Number))
          .refine((n) => n >= 0)
          .optional()
          .describe('Số lượng lấy'),
        queryInput: z.string().optional().describe('Điều kiện lọc'),
        select: z.string().optional().describe('Chọn trường cần lấy')
      }),
      response: {}
    },
    handler: async (req, res) => {
      try {
        const { skip, limit, queryInput, select } = req.query
        let queryInputParse: any = {}
        let selectArrselectParse: any = { id: true, name: true, images: true }
        if (queryInput) {
          queryInputParse = JSON.parse(queryInput)
        }
        if (select) {
          const selectArr = select.split(',')
          selectArrselectParse = selectArr.reduce((acc: any, curr: any) => {
            acc[curr] = true
            return acc
          }, {})
        }
        const now = new Date().getTime()
        const where: Prisma.voucherWhereInput = {
          isActive: true,
          isApprove: true,
          startDate: { lte: now },
          endDate: { gt: now },
          payment: {
            not: 'free'
          }
        }
        if (queryInputParse && Object.keys(queryInputParse).length > 0) {
          if (queryInputParse.id) {
            if (Object.hasOwn(queryInputParse.id, 'contains')) {
              where.id = Number(queryInputParse.id.contains)
            } else if (
              Array.isArray(queryInputParse.id) &&
              queryInputParse.id.length > 0
            ) {
              where.id = { in: queryInputParse.id }
            } else {
              where.id = queryInputParse.id
            }
          }
          if (queryInputParse.name) {
            where.name = queryInputParse.name
          }
        }
        const [vouchers, total] = await prismaClient.$transaction([
          prismaClient.voucher.findMany({
            where,
            select: selectArrselectParse,
            skip: skip || 0,
            take: limit || 10
          }),
          prismaClient.voucher.count({ where })
        ])
        return res.send({
          code: 0,
          message: 'Thành công',
          data: vouchers,
          count: total
        })
      } catch (err) {
        console.log(
          '🚀 ~ file: get-voucher-flashsale.ts:66 ~ handler: ~ err:',
          err
        )
        return res.status(500).send({
          code: 1,
          message: 'Lỗi hệ thống',
          err
        })
      }
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
