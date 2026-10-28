import { Prisma, RoleSpecial } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import { prismaClient } from "@src/utils/prisma";

const querySchema = z.object({
  calculationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});

function safeNumber(value: bigint | number | null | undefined): number {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number))
    throw new Error("amount exceeds safe integer range");
  return number;
}

type SummaryRow = {
  total: bigint;
  filteredTotal: bigint;
  totalDistributedAmount: bigint;
};
type DistributionRow = {
  customerId: number;
  name: string | null;
  username: string | null;
  phone: string | null;
  email: string | null;
  distributedAmount: bigint;
  totalEntitlementAmount: bigint | null;
  totalAccumulatedAmount: bigint | null;
};

export async function registerDistributionRoutes(
  fastify: FastifyInstance,
  dependencies: {
    client?: typeof prismaClient;
    middleware?: typeof userMiddleware;
  } = {},
) {
  const client = dependencies.client ?? prismaClient;
  const middleware = dependencies.middleware ?? userMiddleware;
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/distributions",
    preHandler: [middleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Chi tiết khách hàng nhận tích sản theo ngày",
      querystring: querySchema,
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
      const { calculationDate, skip, limit, search } = req.query;
      try {
        const searchPattern = `%${(search || "")
          .replace(/!/g, "!!")
          .replace(/%/g, "!%")
          .replace(/_/g, "!_")}%`;
        const customerFilter = search
          ? Prisma.sql`AND (
              c."name" ILIKE ${searchPattern} ESCAPE '!'
              OR c."phone" ILIKE ${searchPattern} ESCAPE '!'
              OR c."email" ILIKE ${searchPattern} ESCAPE '!'
            )`
          : Prisma.empty;
        const [run, summary, rows] = await client.$transaction([
          client.commissionRun.findUnique({
            where: { calculationDate },
            select: { status: true, errorMessage: true, completedAt: true },
          }),
          client.$queryRaw<SummaryRow[]>(Prisma.sql`
            WITH paid AS (
              SELECT "customerId", SUM("amount")::bigint AS amount
              FROM "commissionTransaction"
              WHERE "calculationDate" = ${calculationDate}
                AND "type" = 'accumulation' AND "direction" = 'credit'
              GROUP BY "customerId"
            )
            SELECT COUNT(*)::bigint AS total,
              COALESCE(SUM(paid.amount), 0)::bigint AS "totalDistributedAmount",
              COUNT(*) FILTER (WHERE ${!search} OR (
                c."name" ILIKE ${searchPattern} ESCAPE '!'
                OR c."phone" ILIKE ${searchPattern} ESCAPE '!'
                OR c."email" ILIKE ${searchPattern} ESCAPE '!'
              ))::bigint AS "filteredTotal"
            FROM paid
            LEFT JOIN customer c ON c.id = paid."customerId"
          `),
          client.$queryRaw<DistributionRow[]>(Prisma.sql`
            WITH paid AS (
              SELECT "customerId", SUM("amount")::bigint AS "distributedAmount"
              FROM "commissionTransaction"
              WHERE "calculationDate" = ${calculationDate}
                AND "type" = 'accumulation' AND "direction" = 'credit'
              GROUP BY "customerId"
            )
            SELECT paid."customerId", c."name", c."username", c."phone", c."email",
              paid."distributedAmount", w."entitlementAmount" AS "totalEntitlementAmount",
              w."receivedAmount" AS "totalAccumulatedAmount"
            FROM paid
            LEFT JOIN "customer" c ON c."id" = paid."customerId"
            LEFT JOIN "commissionWallet" w
              ON w."customerId" = paid."customerId" AND w."walletType" = 'accumulation'
            WHERE TRUE ${customerFilter}
            ORDER BY paid."distributedAmount" DESC, paid."customerId" ASC
            OFFSET ${skip} LIMIT ${limit}
          `),
        ]);
        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            calculationDate,
            runStatus: run?.status ?? null,
            runError: run?.status === "failed" ? run.errorMessage : null,
            completedAt: run?.completedAt ? safeNumber(run.completedAt) : null,
            total: safeNumber(summary[0]?.total),
            filteredTotal: safeNumber(summary[0]?.filteredTotal),
            totalDistributedAmount: safeNumber(
              summary[0]?.totalDistributedAmount,
            ),
            skip,
            limit,
            items: rows.map((row) => {
              const totalEntitlementAmount = safeNumber(
                row.totalEntitlementAmount,
              );
              const totalAccumulatedAmount = safeNumber(
                row.totalAccumulatedAmount,
              );
              return {
                customerId: row.customerId,
                name: row.name,
                username: row.username,
                phone: row.phone,
                email: row.email,
                distributedAmount: safeNumber(row.distributedAmount),
                totalEntitlementAmount,
                remainingAmount: Math.max(
                  totalEntitlementAmount - totalAccumulatedAmount,
                  0,
                ),
              };
            }),
          },
        });
      } catch (error: any) {
        req.log.error(error);
        return res
          .code(500)
          .send({ code: 1, message: "Không thể tải chi tiết chia tích sản" });
      }
    },
  });
}

export default registerDistributionRoutes;
