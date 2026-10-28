import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import Conf from '@src/services/conf'
import { prismaClient } from '@root/src/utils/prisma'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/cron-update-purchased-item`,
    // Define your schema
    schema: {
      // body: z.object({
      // }),
      querystring: z.object({
        auth: z.string().min(1).describe('Xác thực client call')
      }),
      response: {}
    },
    handler: async (req, res) => {
      try {
        const { auth } = req.query
        if (
          auth !==
          Conf.get('TECT_SECRET', 'a565d01e-3dd4-4464-b8e2-9d49e3a460d')
        ) {
          return res.code(403).send({
            code: 2,
            message: 'Unauthorized'
          })
        }
        await prismaClient.$queryRaw`
          WITH tableAAA AS (
          	SELECT
          		* 
          	FROM
          		(
          		SELECT
          			voucher."id",
          			voucher."itemId",
          			item.total,
          			item.purchased,
          			refTable."totalReal",
          			limiter."limitProgram" 
          		FROM
          			( SELECT COUNT ( * ) AS "totalReal", "voucherId" FROM code GROUP BY code."voucherId" ) AS refTable
          			JOIN voucher ON voucher."id" = refTable."voucherId"
          			JOIN item ON item."id" = voucher."itemId"
          			LEFT JOIN limiter ON limiter."itemId" = item."id" 
          		) tableRef2 
          	WHERE
          		tableRef2."totalReal" != tableRef2.purchased 
          	ORDER BY
          		tableRef2."id" ASC 
          	) UPDATE item 
          	SET purchased = tableAAA."totalReal" 
          FROM
          	tableAAA 
          WHERE
          	item."id" = tableAAA."itemId"
        `
        return res.send({
          code: 0,
          message: 'Thành công'
        })
      } catch (err) {
        return res.code(500).send({
          code: 1,
          message: err
        })
      }
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
