import { Prisma, RoleSpecial } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMiddleware from "@root/src/middleware/user";
import { prismaClient } from "@src/utils/prisma";

const customerIdSchema = z.number().int().positive().max(2147483647);
const bodySchema = z.object({
  customerId: customerIdSchema,
  amount: z
    .number()
    .int()
    .safe()
    .refine((value) => value !== 0),
  requestId: z.string().uuid().optional(),
});
const querySchema = z.object({
  customerId: z.coerce.number().int().positive().max(2147483647),
});

type WalletTotals = {
  entitlementAmount: bigint;
  receivedAmount: bigint;
  cashBalance: bigint;
};

function safeMoney(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new Error("Số tiền tích sản vượt giới hạn an toàn");
  }
  return amount;
}

async function totals(tx: any, customerId: number): Promise<WalletTotals> {
  const rows = (await tx.$queryRaw(Prisma.sql`
    SELECT COALESCE(MAX("entitlementAmount") FILTER (
      WHERE "walletType" = 'accumulation'), 0)::bigint AS "entitlementAmount",
      COALESCE(MAX("receivedAmount") FILTER (
      WHERE "walletType" = 'accumulation'), 0)::bigint AS "receivedAmount",
      COALESCE(MAX("balance") FILTER (
      WHERE "walletType" = 'total'), 0)::bigint AS "cashBalance"
    FROM "commissionWallet" WHERE "customerId" = ${customerId}
  `)) as WalletTotals[];
  return rows[0];
}

function responseTotals(wallet: WalletTotals) {
  return {
    totalEntitlementAmount: safeMoney(wallet.entitlementAmount),
    totalAccumulatedAmount: safeMoney(wallet.receivedAmount),
    remainingAmount: safeMoney(
      wallet.entitlementAmount - wallet.receivedAmount,
    ),
  };
}

function allowed(req: any): boolean {
  return (
    req.roleSpecial === RoleSpecial.ROOT ||
    req.roleSpecial === RoleSpecial.ADMIN
  );
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/received-adjustments/balance",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Xem số tích sản đã nhận và hạn mức còn lại",
      querystring: querySchema,
      response: {},
    },
    handler: async (req: any, res) => {
      if (!allowed(req)) {
        return res
          .code(403)
          .send({ code: 1, message: "Không có quyền truy cập" });
      }
      const customerId = req.query.customerId;
      try {
        const customer = await prismaClient.customer.findUnique({
          where: { id: customerId },
          select: { id: true },
        });
        if (!customer) {
          return res
            .code(404)
            .send({ code: 1, message: "Khách hàng không tồn tại" });
        }
        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            customerId,
            ...responseTotals(await totals(prismaClient, customerId)),
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res
          .code(500)
          .send({ code: 1, message: "Không thể tải số liệu tích sản" });
      }
    },
  });

  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/received-adjustments",
    preHandler: [userMiddleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Cộng/trừ số tích sản đã nhận",
      description:
        "Phân bổ điều chỉnh vào hạn mức cũ trước. Hạn mức còn lại đổi ngược chiều; không cộng/trừ ví hoa hồng và không tạo giao dịch tiền mặt.",
      body: bodySchema,
      response: {},
    },
    handler: async (req: any, res) => {
      if (!allowed(req)) {
        return res
          .code(403)
          .send({ code: 1, message: "Không có quyền truy cập" });
      }
      const { customerId, amount } = req.body;
      const requestId: string = req.body.requestId || randomUUID();
      const delta = BigInt(amount);
      try {
        const result = await prismaClient.$transaction(
          async (tx) => {
            // Trigger đồng bộ ví dùng cùng khóa customer này.
            await tx.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
            SELECT 1 AS locked FROM pg_advisory_xact_lock(170614, ${customerId})
          `);
            const customer = await tx.customer.findUnique({
              where: { id: customerId },
              select: { id: true },
            });
            if (!customer) return { status: "not_found" as const };

            const earlier = await tx.accumulationReceivedAdjustment.findUnique({
              where: { requestId },
            });
            if (earlier) {
              if (
                earlier.customerId !== customerId ||
                earlier.amount !== delta
              ) {
                return { status: "conflict" as const };
              }
              return {
                status: "already_applied" as const,
                wallet: await totals(tx, customerId),
              };
            }

            // Không dùng snapshot cũ khi cron đang quyết toán một kỳ.
            const running = await tx.commissionRun.findFirst({
              where: {
                status: { in: ["calculating", "persisting"] },
                startedAt: { gte: BigInt(Date.now() - 30 * 60 * 1000) },
              },
              select: { id: true },
            });
            if (running) return { status: "run_in_progress" as const };

            const before = await totals(tx, customerId);
            if (
              before.receivedAmount + delta < BigInt(0) ||
              before.receivedAmount + delta > before.entitlementAmount
            ) {
              return { status: "outside_limit" as const };
            }

            const [orders, grants] = await Promise.all([
              tx.accumulationEntitlement.findMany({
                where: { customerId },
                select: {
                  id: true,
                  sourceCreatedAt: true,
                  receivedAmount: true,
                  remainingAmount: true,
                  maximumAmount: true,
                },
              }),
              tx.accumulationManualEntitlement.findMany({
                where: { customerId, maximumAmount: { gt: BigInt(0) } },
                select: {
                  id: true,
                  createdAt: true,
                  receivedAmount: true,
                  remainingAmount: true,
                  maximumAmount: true,
                },
              }),
            ]);
            const sources = [
              ...orders.map((row) => ({
                kind: "order" as const,
                id: String(row.id),
                createdAt: row.sourceCreatedAt,
                received: row.receivedAmount,
                remaining: row.remainingAmount,
                maximum: row.maximumAmount,
              })),
              ...grants.map((row) => ({
                kind: "manual" as const,
                id: row.id,
                createdAt: row.createdAt,
                received: row.receivedAmount,
                remaining: row.remainingAmount,
                maximum: row.maximumAmount,
              })),
            ].sort((left, right) =>
              left.createdAt < right.createdAt
                ? -1
                : left.createdAt > right.createdAt
                  ? 1
                  : left.id.localeCompare(right.id),
            );

            const allocatable = sources.reduce(
              (sum, source) =>
                sum + (delta > 0 ? source.remaining : source.received),
              BigInt(0),
            );
            if (allocatable < (delta < 0 ? -delta : delta)) {
              return { status: "no_allocatable_entitlement" as const };
            }

            let outstanding = delta < 0 ? -delta : delta;
            const allocations: Array<{
              kind: string;
              id: string;
              amount: number;
            }> = [];
            const now = BigInt(Date.now());
            for (const source of sources) {
              if (
                source.received < 0 ||
                source.remaining < 0 ||
                source.received + source.remaining !== source.maximum
              ) {
                throw new Error(
                  `Hạn mức ${source.kind}:${source.id} không nhất quán`,
                );
              }
              const available = delta > 0 ? source.remaining : source.received;
              if (available <= 0 || outstanding === BigInt(0)) continue;
              const portion = outstanding < available ? outstanding : available;
              const change = delta > 0 ? portion : -portion;
              const nextReceived = source.received + change;
              const nextRemaining = source.remaining - change;
              if (source.kind === "order") {
                await tx.accumulationEntitlement.update({
                  where: { id: BigInt(source.id) },
                  data: {
                    receivedAmount: nextReceived,
                    remainingAmount: nextRemaining,
                    completed: nextRemaining === BigInt(0),
                    updatedAt: now,
                  },
                });
              } else {
                await tx.accumulationManualEntitlement.update({
                  where: { id: source.id },
                  data: {
                    receivedAmount: nextReceived,
                    remainingAmount: nextRemaining,
                    updatedAt: now,
                  },
                });
              }
              allocations.push({
                kind: source.kind,
                id: source.id,
                amount: safeMoney(change),
              });
              outstanding -= portion;
            }
            if (outstanding !== BigInt(0)) {
              throw new Error("Không phân bổ hết khoản điều chỉnh");
            }

            const after = await totals(tx, customerId);
            if (
              after.entitlementAmount !== before.entitlementAmount ||
              after.receivedAmount !== before.receivedAmount + delta ||
              after.cashBalance !== before.cashBalance
            ) {
              throw new Error("Ví tích sản không khớp sau điều chỉnh");
            }
            await tx.accumulationReceivedAdjustment.create({
              data: {
                id: randomUUID(),
                requestId,
                customerId,
                amount: delta,
                allocations,
                adminUserId: req.userId,
                createdAt: now,
              },
            });
            return { status: "created" as const, wallet: after };
          },
          { maxWait: 30000, timeout: 120000 },
        );

        if (result.status === "not_found") {
          return res
            .code(404)
            .send({ code: 1, message: "Khách hàng không tồn tại" });
        }
        if (result.status === "conflict") {
          return res
            .code(409)
            .send({ code: 1, message: "Mã yêu cầu đã dùng cho thao tác khác" });
        }
        if (result.status === "run_in_progress") {
          return res.code(409).send({
            code: 1,
            message: "Đang quyết toán tích sản; vui lòng thử lại sau",
          });
        }
        if (result.status === "outside_limit") {
          return res.code(422).send({
            code: 1,
            message: "Số đã nhận phải nằm từ 0 đến tổng hạn mức",
          });
        }
        if (result.status === "no_allocatable_entitlement") {
          return res.code(422).send({
            code: 1,
            message: "Không đủ hạn mức theo đơn để phân bổ khoản điều chỉnh",
          });
        }
        return res.send({
          code: 0,
          message:
            result.status === "already_applied"
              ? "Yêu cầu đã được xử lý trước đó"
              : amount > 0
                ? "Đã cộng số tích sản đã nhận"
                : "Đã trừ số tích sản đã nhận",
          data: {
            customerId,
            amount,
            requestId,
            alreadyApplied: result.status === "already_applied",
            ...responseTotals(result.wallet),
          },
        });
      } catch (error: any) {
        if (error?.code === "P2002") {
          return res.code(409).send({
            code: 1,
            message: "Mã yêu cầu điều chỉnh đã được xử lý",
          });
        }
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể điều chỉnh số tích sản đã nhận lúc này",
        });
      }
    },
  });
};
