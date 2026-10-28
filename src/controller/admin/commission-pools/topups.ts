import { RoleSpecial } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import {
  businessDateFromTimestamp,
  manualPoolAfterAdjustment,
} from "@src/services/accumulationPoolTopup.core";
import { prismaClient } from "@src/utils/prisma";

const bodySchema = z.object({
  amount: z
    .number()
    .int()
    .min(-Number.MAX_SAFE_INTEGER)
    .max(Number.MAX_SAFE_INTEGER)
    .refine((value) => value !== 0, "Số tiền phải khác 0"),
  reason: z.string().trim().max(500).optional(),
  requestId: z.string().trim().min(1).max(100).optional(),
});

const querySchema = z.object({
  calculationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function money(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new Error("manual accumulation pool exceeds safe integer range");
  }
  return amount;
}

export async function registerTopupRoutes(
  fastify: FastifyInstance,
  dependencies: {
    client?: typeof prismaClient;
    middleware?: typeof userMiddleware;
    now?: () => number;
  } = {},
) {
  const client = dependencies.client ?? prismaClient;
  const middleware = dependencies.middleware ?? userMiddleware;
  const now = dependencies.now ?? Date.now;
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/topups",
    preHandler: [middleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Xem quỹ chia tích sản theo ngày",
      querystring: querySchema,
      response: {},
    },
    handler: async (req: any, res) => {
      if (
        req.roleSpecial !== RoleSpecial.ROOT &&
        req.roleSpecial !== RoleSpecial.ADMIN
      ) {
        return res.code(403).send({ code: 1, message: "Không có quyền truy cập" });
      }
      const calculationDate =
        req.query.calculationDate || businessDateFromTimestamp(now());
      try {
        const [run, topups, settledPools] = await Promise.all([
          client.commissionRun.findUnique({
            where: { calculationDate },
            select: { status: true },
          }),
          client.$queryRaw<Array<{ amount: bigint }>>`
            SELECT COALESCE(SUM("amount"), 0)::bigint AS amount
            FROM "accumulationPoolTopup"
            WHERE "calculationDate" = ${calculationDate}
          `,
          client.$queryRaw<Array<{ amount: bigint }>>`
            SELECT COALESCE(SUM("availableAmount"), 0)::bigint AS amount
            FROM "accumulationPoolDaily"
            WHERE "calculationDate" = ${calculationDate}
          `,
        ]);
        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            calculationDate,
            runStatus: run?.status || null,
            manualPoolAmount: money(topups[0].amount),
            settledPoolAmount:
              run?.status === "completed" ? money(settledPools[0].amount) : null,
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể tải quỹ chia tích sản lúc này",
        });
      }
    },
  });
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/topups",
    preHandler: [middleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Điều chỉnh quỹ tích sản của ngày hiện tại",
      description:
        "Số dương cộng quỹ, số âm trừ phần admin đã cộng trong ngày Việt Nam. Cron 07:00 hôm sau đưa số dư điều chỉnh vào quỹ Mục 2 rồi chia theo nhóm đơn; không cộng ngay vào ví khách hoặc doanh thu đơn hàng.",
      body: bodySchema,
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

      const { amount, reason, requestId } = req.body;
      const calculationDate = businessDateFromTimestamp(now());
      const idempotencyKey = `manual-accumulation-pool:${requestId || randomUUID()}`;
      try {
        const result = await client.$transaction(async (tx) => {
          // Cùng khóa với lúc cron nhận kỳ quyết toán, tránh khoản điều chỉnh lọt
          // vào DB sau khi cron đã chụp snapshot đầu vào.
          await tx.$queryRaw<Array<{ locked: number }>>`
            SELECT 1 AS locked FROM pg_advisory_xact_lock(
              170615, ${Number(calculationDate.replaceAll("-", ""))}
            )
          `;
          const run = await tx.commissionRun.findUnique({
            where: { calculationDate },
            select: { status: true },
          });
          if (run && !["pending", "failed"].includes(run.status)) {
            return { status: "settled" as const };
          }

          const existing = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"::text AS id FROM "accumulationPoolTopup"
            WHERE "idempotencyKey" = ${idempotencyKey}
          `;
          if (existing.length) return { status: "duplicate" as const };

          const totals = await tx.$queryRaw<Array<{ amount: bigint }>>`
            SELECT COALESCE(SUM("amount"), 0)::bigint AS amount
            FROM "accumulationPoolTopup"
            WHERE "calculationDate" = ${calculationDate}
          `;
          const nextTotal = manualPoolAfterAdjustment(totals[0].amount, amount);
          if (nextTotal === null) return { status: "insufficient" as const };

          const id = randomUUID();
          await tx.$executeRaw`
            INSERT INTO "accumulationPoolTopup"
              ("id", "idempotencyKey", "calculationDate", "amount",
               "reason", "adminUserId", "createdAt")
            VALUES (${id}::uuid, ${idempotencyKey}, ${calculationDate},
              ${BigInt(amount)}, ${reason || ""}, ${req.userId ?? null}, ${BigInt(now())})
          `;
          return {
            status: "created" as const,
            id,
            totalManualPoolAmount: money(nextTotal),
          };
        });

        if (result.status === "settled") {
          return res.code(409).send({
            code: 1,
            message:
              "Quỹ ngày hôm nay đã bắt đầu quyết toán; không thể điều chỉnh thêm",
          });
        }
        if (result.status === "duplicate") {
          return res
            .code(409)
            .send({ code: 1, message: "Yêu cầu đã được xử lý" });
        }
        if (result.status === "insufficient") {
          return res.code(400).send({
            code: 1,
            message: "Số tiền trừ vượt phần admin đã cộng vào quỹ hôm nay",
          });
        }
        return res.send({
          code: 0,
          message:
            amount > 0
              ? "Đã cộng tiền vào quỹ tích sản"
              : "Đã trừ tiền khỏi quỹ tích sản",
          data: {
            id: result.id,
            calculationDate,
            amount,
            totalManualPoolAmount: result.totalManualPoolAmount,
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể điều chỉnh quỹ tích sản lúc này",
        });
      }
    },
  });
}

export default registerTopupRoutes;
