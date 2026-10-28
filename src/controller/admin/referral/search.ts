import { Prisma, RoleSpecial } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import { prismaClient } from "@src/utils/prisma";
import { HIDDEN_TEST_ROOT_IDS, isHiddenTestRoot } from "./hidden-test-roots";

type MatchRow = {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
};

type PathRow = {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  depth: number;
  siblingPosition: bigint | null;
  parentId: number | null;
};

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/search",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Tìm thành viên trong cây giới thiệu",
      querystring: z.object({
        search: z.string().trim().min(1).max(100),
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

      try {
        const search = req.query.search as string;
        const pattern = `%${search
          .replace(/!/g, "!!")
          .replace(/%/g, "!%")
          .replace(/_/g, "!_")}%`;
        const matches = await prismaClient.$queryRaw<MatchRow[]>(Prisma.sql`
          WITH RECURSIVE matched AS (
            SELECT c.id, c.name, c.phone, c.email
            FROM customer c
            WHERE (
              (c.id::text = ${search})
              OR c."username" ILIKE ${pattern} ESCAPE '!'
              OR
              c.name ILIKE ${pattern} ESCAPE '!'
              OR c.phone ILIKE ${pattern} ESCAPE '!'
              OR c.email ILIKE ${pattern} ESCAPE '!'
            )
            AND (
              c."salesRevenue" IS NOT NULL
              OR EXISTS (SELECT 1 FROM referral r WHERE r."referredCustomerId" = c.id)
              OR EXISTS (SELECT 1 FROM referral r WHERE r."referrerCustomerId" = c.id)
            )
          ), ancestors AS (
            SELECT matched.id AS "matchId", matched.id AS "ancestorId",
              ARRAY[matched.id] AS path
            FROM matched
            UNION ALL
            SELECT ancestors."matchId", edge."referrerCustomerId",
              ancestors.path || edge."referrerCustomerId"
            FROM ancestors
            INNER JOIN referral edge
              ON edge."referredCustomerId" = ancestors."ancestorId"
            WHERE NOT edge."referrerCustomerId" = ANY(ancestors.path)
          )
          SELECT c.id, c.name, c.phone, c.email
          FROM matched c
          WHERE NOT EXISTS (
            SELECT 1 FROM ancestors a
            WHERE a."matchId" = c.id
              AND a."ancestorId" IN (${Prisma.join(HIDDEN_TEST_ROOT_IDS)})
          )
          ORDER BY CASE
            WHEN c.id::text = ${search} THEN -1
            WHEN c.phone = ${search} OR lower(c.email) = lower(${search}) THEN 0
            WHEN lower(c.name) = lower(${search}) THEN 1
            ELSE 2
          END, c.id ASC
          LIMIT 10
        `);

        const results = await Promise.all(
          matches.map(async (match) => {
            const pathRows = await prismaClient.$queryRaw<PathRow[]>(Prisma.sql`
              WITH RECURSIVE ancestors (id, "parentId", depth, path) AS (
                SELECT c.id, r."referrerCustomerId", 0, ARRAY[c.id]
                FROM customer c
                LEFT JOIN referral r ON r."referredCustomerId" = c.id
                WHERE c.id = ${match.id}
                UNION ALL
                SELECT parent.id, parent_edge."referrerCustomerId",
                  ancestors.depth + 1, ancestors.path || parent.id
                FROM ancestors
                INNER JOIN customer parent ON parent.id = ancestors."parentId"
                LEFT JOIN referral parent_edge
                  ON parent_edge."referredCustomerId" = parent.id
                WHERE NOT parent.id = ANY(ancestors.path)
              )
              SELECT ancestors.id, parent_customer.name,
                parent_customer.phone, parent_customer.email,
                ancestors."parentId", ancestors.depth,
                CASE WHEN ancestors."parentId" IS NULL THEN NULL
                  ELSE (
                    SELECT COUNT(*)::bigint FROM referral sibling
                    WHERE sibling."referrerCustomerId" = ancestors."parentId"
                      AND sibling."referredCustomerId" < ancestors.id
                  )
                END AS "siblingPosition"
              FROM ancestors
              INNER JOIN customer parent_customer
                ON parent_customer.id = ancestors.id
              ORDER BY ancestors.depth DESC
            `);
            if (!pathRows.length || pathRows[0].parentId !== null) {
              throw new Error(
                `Cây giới thiệu của customer ${match.id} không hợp lệ`,
              );
            }
            if (isHiddenTestRoot(pathRows[0].id)) return null;
            const parent = pathRows[pathRows.length - 2];
            return {
              ...match,
              rootId: pathRows[0].id,
              parent: parent
                ? {
                    id: parent.id,
                    name: parent.name,
                    phone: parent.phone,
                    email: parent.email,
                  }
                : null,
              path: pathRows.map((row) => ({
                id: row.id,
                name: row.name,
                phone: row.phone,
                email: row.email,
                siblingPosition: Number(row.siblingPosition ?? 0),
              })),
            };
          }),
        );
        const items = results.filter((item) => item !== null);
        return res.send({ code: 0, message: "Thành công", data: { items } });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể tìm thành viên cây giới thiệu lúc này",
        });
      }
    },
  });
};
