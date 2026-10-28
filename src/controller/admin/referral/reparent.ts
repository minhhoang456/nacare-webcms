import { Prisma, RoleSpecial } from '@prisma/client'
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import userMiddleware from '@src/middleware/user'
import { prismaClient } from '@src/utils/prisma'

// Shared with the Go referral service and the Excel tree importer.
const REFERRAL_TREE_LOCK_ID = '724656337252656101'
const customerIdSchema = z.number().int().positive().max(2147483647)
const changeSchema = z
  .object({
    customerId: customerIdSchema,
    referrerCustomerId: customerIdSchema,
    expectedReferrerCustomerId: customerIdSchema.nullable(),
  })
  .strict()

class ReferralConflictError extends Error {}
class CustomerNotFoundError extends Error {}

async function requireAdmin(req: FastifyRequest, res: FastifyReply) {
  const { roleSpecial } = req as FastifyRequest & { roleSpecial?: string }
  if (roleSpecial !== RoleSpecial.ADMIN && roleSpecial !== RoleSpecial.ROOT) {
    return res.code(403).send({ code: 1, message: 'Không có quyền truy cập' })
  }
}

export default async function (fastify: FastifyInstance) {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'PUT',
    url: '/reparent',
    preHandler: [userMiddleware, requireAdmin],
    schema: {
      tags: ['Admin'],
      summary: 'Admin - Thay đổi người giới thiệu, giữ nguyên tuyến dưới',
      description:
        'Mặc định chỉ xem trước (dryRun=true). Tất cả tài khoản phải tồn tại trước khi đổi cây. expectedReferrerCustomerId=null nếu chưa có cha. Các thay đổi được áp dụng cùng transaction. Kỳ realtime đã có snapshot giữ nguyên cây đã chụp; kỳ chưa có snapshot dùng cây mới.',
      querystring: z.object({ accesstoken: z.string().optional() }),
      body: z
        .object({
          changes: z
            .array(changeSchema)
            .min(1)
            .max(50)
            .refine(
              (changes) =>
                new Set(changes.map((change) => change.customerId)).size ===
                changes.length,
              'Mỗi customerId chỉ được xuất hiện một lần',
            ),
          reason: z.string().trim().min(5).max(500),
          dryRun: z.boolean().default(true),
        })
        .strict(),
      response: {
        403: z.object({ code: z.number(), message: z.string() }),
        404: z.object({ code: z.number(), message: z.string() }),
        409: z.object({ code: z.number(), message: z.string() }),
        500: z.object({ code: z.number(), message: z.string() }),
        200: z.object({
          code: z.literal(0),
          message: z.string(),
          data: z.object({
            dryRun: z.boolean(),
            changes: z.array(
              z.object({
                customerId: customerIdSchema,
                previousReferrerCustomerId: customerIdSchema.nullable(),
                referrerCustomerId: customerIdSchema,
                changed: z.boolean(),
                downlineCount: z.number().int().min(0),
              }),
            ),
          }),
        }),
      },
    },
    handler: async (req, res) => {
      const { changes, reason, dryRun } = req.body
      const { userId } = req as FastifyRequest & { userId?: number }
      try {
        const result = await prismaClient.$transaction(
          async (tx) => {
            await tx.$queryRaw(Prisma.sql`
            SELECT 1 FROM pg_advisory_xact_lock(
              ${REFERRAL_TREE_LOCK_ID}::bigint
            )
          `)
            const ids = [
              ...new Set(
                changes.flatMap((change) => [
                  change.customerId,
                  change.referrerCustomerId,
                ]),
              ),
            ].sort((left, right) => left - right)
            const customers = await tx.$queryRaw<
              Array<{ id: number; inviteCode: string; isBlock: boolean | null }>
            >(Prisma.sql`
            SELECT id, "inviteCode", "isBlock" FROM customer
            WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE
          `)
            if (customers.length !== ids.length) {
              throw new CustomerNotFoundError(
                'Tất cả tài khoản phải tồn tại trước khi thay đổi cây',
              )
            }
            if (customers.some((customer) => customer.isBlock)) {
              throw new ReferralConflictError(
                'Không thể đổi liên kết cho tài khoản đang bị khóa',
              )
            }
            await tx.$queryRaw(Prisma.sql`
            SELECT id FROM referral
            WHERE "referredCustomerId" IN (
              ${Prisma.join(changes.map((change) => change.customerId))}
            ) ORDER BY id FOR UPDATE
          `)
            const edges = await tx.referral.findMany({
              where: {
                referredCustomerId: {
                  in: changes.map((item) => item.customerId),
                },
              },
              select: { referredCustomerId: true, referrerCustomerId: true },
            })
            const parentById = new Map(
              edges.map((edge) => [
                edge.referredCustomerId,
                edge.referrerCustomerId,
              ]),
            )
            const plan = changes.map((change) => {
              const previous = parentById.get(change.customerId) ?? null
              const changed = previous !== change.referrerCustomerId
              if (changed && previous !== change.expectedReferrerCustomerId) {
                throw new ReferralConflictError(
                  `Người giới thiệu của customer ${change.customerId} đã thay đổi; cần kiểm tra lại cây`,
                )
              }
              return {
                customerId: change.customerId,
                previousReferrerCustomerId: previous,
                referrerCustomerId: change.referrerCustomerId,
                changed,
              }
            })

            // Check the final graph, including all moves in this request.
            const [validation] = await tx.$queryRaw<
              Array<{ hasCycle: boolean }>
            >(
              Prisma.sql`
              WITH RECURSIVE changes AS (
                SELECT "customerId", "referrerCustomerId"
                FROM jsonb_to_recordset(${JSON.stringify(changes)}::jsonb)
                  AS item("customerId" int, "referrerCustomerId" int)
              ), ancestors AS (
                SELECT "referrerCustomerId" AS id, ARRAY["customerId"] AS path
                FROM changes
                UNION ALL
                SELECT COALESCE(change."referrerCustomerId", edge."referrerCustomerId"),
                  ancestors.path || ancestors.id
                FROM ancestors
                LEFT JOIN changes change ON change."customerId" = ancestors.id
                LEFT JOIN referral edge ON edge."referredCustomerId" = ancestors.id
                  AND change."customerId" IS NULL
                WHERE ancestors.id IS NOT NULL
                  AND NOT ancestors.id = ANY(ancestors.path)
              )
              SELECT EXISTS (
                SELECT 1 FROM ancestors WHERE id = ANY(path)
              ) AS "hasCycle"
            `,
            )
            if (!validation || validation.hasCycle) {
              throw new ReferralConflictError(
                'Quan hệ giới thiệu tạo thành vòng tròn hoặc cây không hợp lệ',
              )
            }
            const subtreeCounts = await tx.$queryRaw<
              Array<{ customerId: number; downlineCount: bigint }>
            >(Prisma.sql`
              WITH RECURSIVE subtree AS (
                SELECT item."customerId", item."customerId" AS "memberId",
                  ARRAY[item."customerId"] AS path
                FROM jsonb_to_recordset(${JSON.stringify(changes)}::jsonb)
                  AS item("customerId" int, "referrerCustomerId" int)
                UNION ALL
                SELECT subtree."customerId", edge."referredCustomerId",
                  subtree.path || edge."referredCustomerId"
                FROM subtree
                INNER JOIN referral edge
                  ON edge."referrerCustomerId" = subtree."memberId"
                WHERE NOT edge."referredCustomerId" = ANY(subtree.path)
              )
              SELECT "customerId", (COUNT(*) - 1)::bigint AS "downlineCount"
              FROM subtree GROUP BY "customerId"
            `)
            const downlineByCustomer = new Map(
              subtreeCounts.map((item) => [
                item.customerId,
                Number(item.downlineCount),
              ]),
            )
            const detailedPlan = plan.map((item) => ({
              ...item,
              downlineCount: downlineByCustomer.get(item.customerId) ?? 0,
            }))
            if (!dryRun) {
              for (const change of plan) {
                if (!change.changed) continue
                const parent = customers.find(
                  (customer) => customer.id === change.referrerCustomerId,
                )
                if (!parent)
                  throw new CustomerNotFoundError('Không tìm thấy cha mới')
                const data = {
                  referrerCustomerId: parent.id,
                  inviteCode: parent.inviteCode,
                }
                if (change.previousReferrerCustomerId === null) {
                  await tx.referral.create({
                    data: { ...data, referredCustomerId: change.customerId },
                  })
                } else {
                  const updated = await tx.referral.updateMany({
                    where: {
                      referredCustomerId: change.customerId,
                      referrerCustomerId: change.previousReferrerCustomerId,
                    },
                    data,
                  })
                  if (updated.count !== 1) {
                    throw new ReferralConflictError(
                      'Cây đã thay đổi; cần kiểm tra lại',
                    )
                  }
                }
              }
              if (plan.some((item) => item.changed)) {
                await tx.$executeRaw(Prisma.sql`
                  INSERT INTO "referralReparentAudit"
                    ("adminUserId", "reason", "changes", "createdAt")
                  VALUES (${userId ?? null}, ${reason},
                    ${JSON.stringify(detailedPlan)}::jsonb, ${BigInt(Date.now())})
                `)
              }
            }
            return detailedPlan
          },
          { timeout: 30000 },
        )
        req.log.info(
          { adminUserId: userId, reason, dryRun, changes: result },
          'Admin referral reparent',
        )
        return res.send({
          code: 0 as const,
          message: dryRun
            ? 'Kiểm tra thay đổi cây thành công'
            : 'Cập nhật cây thành công',
          data: { dryRun, changes: result },
        })
      } catch (error) {
        if (error instanceof CustomerNotFoundError) {
          return res.code(404).send({ code: 1, message: error.message })
        }
        if (error instanceof ReferralConflictError) {
          return res.code(409).send({ code: 1, message: error.message })
        }
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code)
        ) {
          return res.code(409).send({
            code: 1,
            message: 'Cây đã thay đổi đồng thời; cần kiểm tra và thử lại',
          })
        }
        req.log.error(error, 'Failed to reparent referral tree')
        return res.code(500).send({
          code: 1,
          message: 'Không thể cập nhật cây giới thiệu lúc này',
        })
      }
    },
  })
}
