import { Prisma, RoleSpecial } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import { prismaClient } from "@src/utils/prisma";
import { HIDDEN_TEST_ROOT_IDS, isHiddenTestRoot } from "./hidden-test-roots";

type TreeRow = {
  id: number;
  name: string | null;
  email: string | null;
  inviteCode: string;
  salesRevenue: bigint | null;
  groupRevenue: bigint;
  isBlock: boolean | null;
  directChildrenCount: bigint;
  downlineCount: bigint;
  activeDownlineCount: bigint;
  totalLevels: number;
};

type TreeSummaryRow = {
  totalMembers: bigint;
  totalRoots: bigint;
  activeMembers: bigint;
};

function count(value: bigint | number | null | undefined): number {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number)) {
    throw new Error("Referral tree count exceeds safe integer range");
  }
  return number;
}

function salesRevenue(value: bigint | null): number | null {
  return value === null ? null : count(value);
}

function groupRevenue(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new Error("Referral group revenue exceeds safe integer range");
  }
  return amount;
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/tree",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Danh sách gốc và các cấp trực tiếp của cây giới thiệu",
      description:
        "Không truyền parentId hoặc rootId để lấy các gốc cây, kể cả gốc được import chưa có F1; truyền rootId để lấy một gốc, hoặc parentId để lấy một trang con trực tiếp. Thống kê mỗi node bao gồm toàn bộ cây con.",
      querystring: z
        .object({
          parentId: z.coerce.number().int().positive().optional(),
          rootId: z.coerce.number().int().positive().optional(),
          skip: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .refine((query) => !(query.parentId && query.rootId), {
          message: "Chỉ truyền parentId hoặc rootId",
        }),
      response: {},
    },
    handler: async (req: any, res) => {
      if (
        req.roleSpecial !== RoleSpecial.ROOT &&
        req.roleSpecial !== RoleSpecial.ADMIN
      ) {
        return res
          .code(403)
          .send({ code: 1, message: "Không có quyền truy cập" });
      }

      const { parentId, rootId, skip, limit } = req.query as {
        parentId?: number;
        rootId?: number;
        skip: number;
        limit: number;
      };
      try {
        if (parentId !== undefined) {
          const parent = await prismaClient.customer.findUnique({
            where: { id: parentId },
            select: { id: true },
          });
          if (!parent) {
            return res.code(404).send({
              code: 1,
              message: "Thành viên trong cây không tồn tại",
            });
          }
          const ancestors = await prismaClient.$queryRaw<Array<{ id: number }>>(
            Prisma.sql`
              WITH RECURSIVE ancestors (id, "parentId", path) AS (
                SELECT c.id, r."referrerCustomerId", ARRAY[c.id]
                FROM customer c
                LEFT JOIN referral r ON r."referredCustomerId" = c.id
                WHERE c.id = ${parentId}
                UNION ALL
                SELECT p.id, edge."referrerCustomerId", ancestors.path || p.id
                FROM ancestors
                INNER JOIN customer p ON p.id = ancestors."parentId"
                LEFT JOIN referral edge ON edge."referredCustomerId" = p.id
                WHERE NOT p.id = ANY(ancestors.path)
              )
              SELECT id FROM ancestors WHERE "parentId" IS NULL
            `,
          );
          if (ancestors.some((ancestor) => isHiddenTestRoot(ancestor.id))) {
            return res.code(404).send({
              code: 1,
              message: "Thành viên trong cây không tồn tại",
            });
          }
        }

        // Gốc không có cha: gồm người đã giới thiệu F1 và người được import
        // từ cây Excel nhưng chưa có F1. salesRevenue khác NULL là dấu hiệu
        // hiện có của thành viên thuộc lô import (kể cả doanh thu bằng 0).
        const rootCandidateIds = Prisma.sql`
          SELECT root_customer.id
          FROM customer root_customer
          WHERE NOT EXISTS (
            SELECT 1 FROM referral parent_edge
            WHERE parent_edge."referredCustomerId" = root_customer.id
          )
          AND root_customer.id NOT IN (${Prisma.join(HIDDEN_TEST_ROOT_IDS)})
          AND (
            root_customer."salesRevenue" IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM referral child_edge
              WHERE child_edge."referrerCustomerId" = root_customer.id
            )
          )
        `;
        const candidateIds =
          parentId !== undefined
            ? Prisma.sql`
                SELECT DISTINCT edge."referredCustomerId" AS id
                FROM referral edge
                WHERE edge."referrerCustomerId" = ${parentId}
              `
            : Prisma.sql`
                SELECT root.id
                FROM (${rootCandidateIds}) root
                ${rootId === undefined ? Prisma.empty : Prisma.sql`WHERE root.id = ${rootId}`}
              `;

        // CTV chỉ gồm người được giới thiệu: có quan hệ referral và không tính
        // các gốc cây. Gốc được thống kê riêng, kể cả gốc import chưa có F1.
        const summaryQuery =
          parentId === undefined && rootId === undefined
            ? Prisma.sql`
                WITH RECURSIVE roots AS (${rootCandidateIds}), members AS (
                  SELECT roots.id AS "customerId", 0 AS depth, ARRAY[roots.id] AS path
                  FROM roots
                  UNION ALL
                  SELECT edge."referredCustomerId", members.depth + 1,
                    members.path || edge."referredCustomerId"
                  FROM members
                  INNER JOIN referral edge
                    ON edge."referrerCustomerId" = members."customerId"
                  WHERE NOT edge."referredCustomerId" = ANY(members.path)
                )
                SELECT COUNT(*) FILTER (WHERE members.depth > 0)::bigint AS "totalMembers",
                  (SELECT COUNT(*)::bigint FROM roots) AS "totalRoots",
                  COUNT(*) FILTER (
                    WHERE members.depth > 0
                      AND COALESCE(c."isBlock", FALSE) = FALSE
                  )::bigint AS "activeMembers"
                FROM members
                INNER JOIN customer c ON c.id = members."customerId"
              `
            : Prisma.sql`
                SELECT 0::bigint AS "totalMembers", 0::bigint AS "totalRoots",
                  0::bigint AS "activeMembers"
              `;

        const [totalRows, rows, summaryRows] = await prismaClient.$transaction(
          [
            prismaClient.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
              SELECT COUNT(*)::bigint AS total
              FROM (${candidateIds}) candidate
              INNER JOIN customer c ON c.id = candidate.id
            `),
            prismaClient.$queryRaw<TreeRow[]>(Prisma.sql`
              WITH RECURSIVE selected AS (
                SELECT c.id, c.name, c.email, c."inviteCode", c."isBlock",
                  c."salesRevenue"
                FROM (${candidateIds}) candidate
                INNER JOIN customer c ON c.id = candidate.id
                ORDER BY c.id ASC
                OFFSET ${skip} LIMIT ${limit}
              ), subtree AS (
                SELECT selected.id AS "rootId", selected.id AS "customerId",
                  0 AS depth, ARRAY[selected.id] AS path
                FROM selected
                UNION ALL
                SELECT subtree."rootId", edge."referredCustomerId",
                  subtree.depth + 1,
                  subtree.path || edge."referredCustomerId"
                FROM subtree
                INNER JOIN referral edge
                  ON edge."referrerCustomerId" = subtree."customerId"
                WHERE NOT edge."referredCustomerId" = ANY(subtree.path)
              ), statistics AS (
                SELECT subtree."rootId",
                  COUNT(*) FILTER (WHERE subtree.depth = 1)::bigint AS "directChildrenCount",
                  COUNT(*) FILTER (WHERE subtree.depth > 0)::bigint AS "downlineCount",
                  COUNT(*) FILTER (
                    WHERE subtree.depth > 0 AND COALESCE(member."isBlock", FALSE) = FALSE
                  )::bigint AS "activeDownlineCount",
                  (MAX(subtree.depth) + 1)::int AS "totalLevels"
                FROM subtree
                INNER JOIN customer member ON member.id = subtree."customerId"
                GROUP BY subtree."rootId"
              ), order_revenue AS (
                SELECT o."customerId",
                  SUM(GREATEST(COALESCE(o."totalMoney", 0) - COALESCE(o."shipMoney", 0), 0))::bigint AS amount
                FROM "order" o
                INNER JOIN (SELECT DISTINCT "customerId" FROM subtree) member
                  ON member."customerId" = o."customerId"
                WHERE o."paymentStatus" = 'completed'
                  AND o."timeCompletedOrder" IS NOT NULL
                  AND (o."typeOrder" IS NULL OR o."typeOrder" <> 'return_order')
                  AND (o."sourceOrder" IS NULL OR o."sourceOrder" NOT IN
                    ('commission_positive_repurchase', 'legacy_accumulation_import'))
                  AND (o."requestId" IS NULL OR o."requestId" NOT LIKE 'legacy-accumulation-50:%')
                GROUP BY o."customerId"
              ), revenue_statistics AS (
                SELECT subtree."rootId",
                  SUM(COALESCE(member."salesRevenue", 0) + COALESCE(orders.amount, 0))::bigint AS "groupRevenue"
                FROM subtree
                INNER JOIN customer member ON member.id = subtree."customerId"
                LEFT JOIN order_revenue orders ON orders."customerId" = subtree."customerId"
                GROUP BY subtree."rootId"
              )
              SELECT selected.*, statistics."directChildrenCount",
                statistics."downlineCount", statistics."activeDownlineCount",
                statistics."totalLevels", revenue_statistics."groupRevenue"
              FROM selected
              INNER JOIN statistics ON statistics."rootId" = selected.id
              INNER JOIN revenue_statistics ON revenue_statistics."rootId" = selected.id
              ORDER BY selected.id ASC
            `),
            prismaClient.$queryRaw<TreeSummaryRow[]>(summaryQuery),
          ],
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        );

        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            items: rows.map((row) => ({
              id: row.id,
              name: row.name,
              email: row.email,
              inviteCode: row.inviteCode,
              salesRevenue: salesRevenue(row.salesRevenue),
              groupRevenue: groupRevenue(row.groupRevenue),
              isActive: row.isBlock !== true,
              directChildrenCount: count(row.directChildrenCount),
              downlineCount: count(row.downlineCount),
              activeDownlineCount: count(row.activeDownlineCount),
              totalLevels: count(row.totalLevels),
            })),
            total: count(totalRows[0]?.total),
            skip,
            limit,
            ...(parentId === undefined && rootId === undefined
              ? {
                  summary: {
                    totalMembers: count(summaryRows[0]?.totalMembers),
                    totalRoots: count(summaryRows[0]?.totalRoots),
                    activeMembers: count(summaryRows[0]?.activeMembers),
                  },
                }
              : {}),
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể lấy cây giới thiệu lúc này",
        });
      }
    },
  });
};
