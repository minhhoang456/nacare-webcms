import { Prisma, RoleSpecial } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import { prismaClient } from "@src/utils/prisma";

const querySchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  queryInput: z.string().optional(),
});

const textFilterSchema = z.union([
  z.string(),
  z.object({ contains: z.string() }),
]);
const numberFilterSchema = z.union([
  z.number(),
  z.string(),
  z.object({ contains: z.union([z.number(), z.string()]) }),
]);
const filterSchema = z.object({
  id: numberFilterSchema.optional(),
  customerId: z
    .union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))])
    .optional(),
  customerName: textFilterSchema.optional(),
  customerPhone: textFilterSchema.optional(),
  phoneNumber: textFilterSchema.optional(),
  bankName: textFilterSchema.optional(),
  bankCode: textFilterSchema.optional(),
  bankAccountNumber: textFilterSchema.optional(),
  status: textFilterSchema.optional(),
  createdAt: z
    .object({
      gte: z.coerce.number().int().nonnegative().optional(),
      lte: z.coerce.number().int().nonnegative().optional(),
    })
    .optional(),
});

type WithdrawalRow = {
  id: bigint;
  customerId: number;
  customerName: string | null;
  customerUsername: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  bankName: string;
  bankCode: string;
  bankAccountNumber: string;
  phoneNumber: string;
  amount: bigint;
  taxPercent: number | null;
  receivedAmount: bigint | null;
  status: string;
  createdAt: bigint | null;
  updatedAt: bigint | null;
};

function safeNumber(value: bigint | number | null | undefined): number {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`withdrawal value is not a safe integer: ${String(value)}`);
  }
  return result;
}

function textValue(value: z.infer<typeof textFilterSchema> | undefined) {
  return (typeof value === "string" ? value : value?.contains)?.trim() || "";
}

function searchPattern(value: string) {
  return `%${value.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_")}%`;
}

function positiveId(value: string | number): bigint | null {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const id = BigInt(text);
  return id > BigInt(0) ? id : null;
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/list",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Danh sách yêu cầu rút tiền hoa hồng",
      description:
        "Sắp xếp pending trước, rejected ở giữa, completed cuối; mới nhất trước trong từng trạng thái.",
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

      const { skip, limit, queryInput } = req.query;
      let filters: z.infer<typeof filterSchema>;
      try {
        filters = filterSchema.parse(queryInput ? JSON.parse(queryInput) : {});
      } catch {
        return res.code(400).send({
          code: 1,
          message: "Bộ lọc yêu cầu rút tiền không hợp lệ",
        });
      }

      const conditions: Prisma.Sql[] = [];
      if (filters.id !== undefined) {
        const rawId =
          typeof filters.id === "object" ? filters.id.contains : filters.id;
        const id = positiveId(rawId);
        if (!id) {
          return res.code(400).send({ code: 1, message: "ID không hợp lệ" });
        }
        conditions.push(Prisma.sql`w."id" = ${id}`);
      }
      if (filters.customerId !== undefined) {
        const selected = Array.isArray(filters.customerId)
          ? filters.customerId
          : [filters.customerId];
        if (selected.length > 0) {
          const ids = selected.map(positiveId);
          if (ids.some((id) => id === null)) {
            return res.code(400).send({
              code: 1,
              message: "Khách hàng được chọn không hợp lệ",
            });
          }
          conditions.push(Prisma.sql`w."customerId" IN (${Prisma.join(ids)})`);
        }
      }
      const textFields: Array<
        [z.infer<typeof textFilterSchema> | undefined, Prisma.Sql]
      > = [
        [filters.customerName, Prisma.sql`c."name"`],
        [filters.customerPhone, Prisma.sql`c."phone"`],
        [filters.phoneNumber, Prisma.sql`w."phoneNumber"`],
        [filters.bankName, Prisma.sql`w."bankName"`],
        [filters.bankCode, Prisma.sql`w."bankCode"`],
        [filters.bankAccountNumber, Prisma.sql`w."bankAccountNumber"`],
      ];
      for (const [value, field] of textFields) {
        const text = textValue(value);
        if (text) {
          conditions.push(
            Prisma.sql`${field} ILIKE ${searchPattern(text)} ESCAPE '!'`,
          );
        }
      }
      const status = textValue(filters.status);
      if (status) {
        if (!["pending", "rejected", "completed"].includes(status)) {
          return res.code(400).send({
            code: 1,
            message: "Trạng thái yêu cầu rút tiền không hợp lệ",
          });
        }
        conditions.push(Prisma.sql`w."status" = ${status}`);
      }
      if (filters.createdAt?.gte !== undefined) {
        conditions.push(
          Prisma.sql`w."createdAt" >= ${BigInt(filters.createdAt.gte)}`,
        );
      }
      if (filters.createdAt?.lte !== undefined) {
        const end = filters.createdAt.lte;
        // Bộ lọc ngày của CMS gửi mốc 00:00; lấy hết ngày kết thúc tại Việt Nam.
        const isVietnamMidnight =
          (end + 7 * 60 * 60 * 1000) % (24 * 60 * 60 * 1000) === 0;
        conditions.push(
          Prisma.sql`w."createdAt" <= ${BigInt(
            isVietnamMidnight ? end + 24 * 60 * 60 * 1000 - 1 : end,
          )}`,
        );
      }
      if (
        filters.createdAt?.gte !== undefined &&
        filters.createdAt?.lte !== undefined &&
        filters.createdAt.gte > filters.createdAt.lte
      ) {
        return res.code(400).send({
          code: 1,
          message: "Khoảng ngày yêu cầu không hợp lệ",
        });
      }
      const where = conditions.length
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;
      try {
        const [rows, totals] = await Promise.all([
          prismaClient.$queryRaw<WithdrawalRow[]>(Prisma.sql`
            SELECT w."id", w."customerId", c."name" AS "customerName",
              c."username" AS "customerUsername",
              c."email" AS "customerEmail", c."phone" AS "customerPhone",
              w."bankName", w."bankCode", w."bankAccountNumber",
              w."phoneNumber", w."amount", w."taxPercent",
              w."receivedAmount", w."status", w."createdAt", w."updatedAt"
            FROM "commissionWithdrawal" w
            LEFT JOIN "customer" c ON c."id" = w."customerId"
            ${where}
            ORDER BY CASE
                WHEN w."status" = 'pending' THEN 0
                WHEN w."status" = 'completed' THEN 2
                ELSE 1
              END ASC,
              w."createdAt" DESC NULLS LAST, w."id" DESC
            OFFSET ${skip} LIMIT ${limit}
          `),
          prismaClient.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
            SELECT COUNT(*)::bigint AS "count"
            FROM "commissionWithdrawal" w
            LEFT JOIN "customer" c ON c."id" = w."customerId"
            ${where}
          `),
        ]);

        return res.send({
          code: 0,
          message: "Thành công",
          count: safeNumber(totals[0]?.count),
          data: rows.map((row) => ({
            id: safeNumber(row.id),
            customerId: row.customerId,
            customerName: row.customerName,
            customerUsername: row.customerUsername,
            customerEmail: row.customerEmail,
            customerPhone: row.customerPhone,
            bankName: row.bankName,
            bankCode: row.bankCode,
            bankAccountNumber: row.bankAccountNumber,
            phoneNumber: row.phoneNumber,
            amount: safeNumber(row.amount),
            taxPercent: row.taxPercent ?? 0,
            taxAmount: safeNumber(
              row.amount - (row.receivedAmount ?? row.amount),
            ),
            receivedAmount: safeNumber(row.receivedAmount ?? row.amount),
            status: row.status,
            createdAt:
              row.createdAt === null ? null : safeNumber(row.createdAt),
            updatedAt:
              row.updatedAt === null ? null : safeNumber(row.updatedAt),
          })),
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể lấy danh sách yêu cầu rút tiền lúc này",
        });
      }
    },
  });
};
