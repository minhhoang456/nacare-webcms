import { Prisma, RoleSpecial } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import userMidlleware from "@root/src/middleware/user";
import { prismaClient } from "@src/utils/prisma";

const errors: Record<string, { status: number; message: string }> = {
  withdrawal_not_found: {
    status: 404,
    message: "Yêu cầu rút tiền không tồn tại",
  },
  withdrawal_already_processed: {
    status: 409,
    message: "Yêu cầu rút tiền đã được xử lý",
  },
  insufficient_commission_balance: {
    status: 422,
    message: "Số dư hoa hồng không đủ để hoàn tất yêu cầu rút tiền",
  },
  withdrawal_ledger_mismatch: {
    status: 409,
    message: "Bút toán rút tiền không khớp yêu cầu, cần kiểm tra dữ liệu",
  },
};

function money(value: bigint | number | null | undefined): number {
  const result = Number(value || 0);
  if (!Number.isSafeInteger(result)) {
    throw new Error(
      `withdrawal amount is not a safe integer: ${String(value)}`,
    );
  }
  return result;
}

function getVietnamDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "PATCH",
    url: "/update-status/:id",
    preHandler: [userMidlleware as any],
    schema: {
      tags: ["Admin"],
      summary: "Admin - Xác nhận hoặc từ chối yêu cầu rút tiền hoa hồng",
      params: z.object({
        id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      }),
      body: z.object({
        action: z.enum(["confirm", "reject"]),
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

      const withdrawalId = Number(req.params?.id);
      const action = req.body?.action as "confirm" | "reject";

      if (!Number.isSafeInteger(withdrawalId) || withdrawalId <= 0) {
        return res.code(400).send({
          code: 1,
          message: "ID yêu cầu rút tiền không hợp lệ",
        });
      }

      try {
        const withdrawal = await prismaClient.$transaction(async (tx) => {
          const current = await tx.commissionWithdrawal.findUnique({
            where: { id: BigInt(withdrawalId) },
          });
          if (!current) throw new Error("withdrawal_not_found");
          if (current.status !== "pending") {
            throw new Error("withdrawal_already_processed");
          }

          // Tạo yêu cầu, xác nhận và từ chối đều giữ cùng khóa theo khách.
          // Trigger ví cũng dùng khóa này khi ghi bút toán hoa hồng.
          await tx.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
              SELECT 1 AS locked FROM pg_advisory_xact_lock(170614, ${current.customerId})
            `);

          // Yêu cầu cũ có thể chưa ghi nợ khi tạo; yêu cầu mới đã ghi nợ.
          const debitKey = `withdrawal:${String(current.id)}`;
          const existingDebit = await tx.commissionTransaction.findUnique({
            where: { idempotencyKey: debitKey },
          });
          if (
            existingDebit &&
            (existingDebit.customerId !== current.customerId ||
              existingDebit.type !== "withdrawal" ||
              existingDebit.direction !== "debit" ||
              existingDebit.amount !== current.amount)
          ) {
            throw new Error("withdrawal_ledger_mismatch");
          }

          if (action === "reject") {
            const updated = await tx.commissionWithdrawal.updateMany({
              where: { id: current.id, status: "pending" },
              data: {
                status: "rejected",
              },
            });
            if (updated.count !== 1) {
              throw new Error("withdrawal_already_processed");
            }
            if (existingDebit) {
              const wallets = await tx.$queryRaw<Array<{ balance: bigint }>>(
                Prisma.sql`
                  SELECT COALESCE((
                    SELECT "balance" FROM "commissionWallet"
                    WHERE "customerId" = ${current.customerId}
                      AND "walletType" = 'total'
                  ), 0)::bigint AS "balance"
                `,
              );
              const balanceBeforeRefund = wallets[0]?.balance ?? BigInt(0);
              await tx.commissionTransaction.create({
                data: {
                  idempotencyKey: `withdrawal-refund:${String(current.id)}`,
                  runId: null,
                  calculationDate: getVietnamDate(),
                  type: "withdrawal",
                  direction: "credit",
                  customerId: current.customerId,
                  grossAmount: balanceBeforeRefund,
                  deductionAmount: BigInt(0),
                  netAmount: balanceBeforeRefund + current.amount,
                  amount: current.amount,
                  metadata: {
                    withdrawalId: String(current.id),
                    action: "refund",
                  },
                  createdAt: BigInt(Date.now()),
                },
              });
            }
            return tx.commissionWithdrawal.findUniqueOrThrow({
              where: { id: current.id },
            });
          }

          if (!existingDebit) {
            // Tương thích yêu cầu pending từ phiên bản cũ: chỉ chúng mới
            // cần ghi nợ ở thời điểm admin xác nhận.
            const balances = await tx.$queryRaw<
              Array<{ availableAmount: bigint }>
            >(Prisma.sql`
              SELECT ("balance" - "reservedAmount" - COALESCE((
                SELECT SUM(r."amount") FROM "commissionWalletOrderReservation" r
                WHERE r."customerId" = ${current.customerId} AND r."status" = 'pending'
              ), 0))::bigint AS "availableAmount"
              FROM "commissionWallet"
              WHERE "customerId" = ${current.customerId} AND "walletType" = 'total'
            `);
            const availableAmount = money(balances[0]?.availableAmount);
            const withdrawalAmount = money(current.amount);
            if (withdrawalAmount > availableAmount) {
              throw new Error("insufficient_commission_balance");
            }

            await tx.commissionTransaction.create({
              data: {
                idempotencyKey: debitKey,
                runId: null,
                calculationDate: getVietnamDate(),
                type: "withdrawal",
                direction: "debit",
                customerId: current.customerId,
                grossAmount: BigInt(availableAmount),
                deductionAmount: current.amount,
                netAmount: BigInt(availableAmount - withdrawalAmount),
                amount: current.amount,
                metadata: {
                  withdrawalId: String(current.id),
                  action: "legacy_confirm",
                },
                createdAt: BigInt(Date.now()),
              },
            });
          }

          const updated = await tx.commissionWithdrawal.updateMany({
            where: { id: current.id, status: "pending" },
            data: {
              status: "completed",
            },
          });
          if (updated.count !== 1) {
            throw new Error("withdrawal_already_processed");
          }

          return tx.commissionWithdrawal.findUniqueOrThrow({
            where: { id: current.id },
          });
        });

        return res.send({
          code: 0,
          message:
            withdrawal.status === "completed"
              ? "Xác nhận rút tiền thành công"
              : "Đã từ chối yêu cầu rút tiền",
        });
      } catch (error: any) {
        const mapped = errors[String(error?.message || error)];
        if (mapped) {
          return res
            .code(mapped.status)
            .send({ code: 1, message: mapped.message });
        }
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể xử lý yêu cầu rút tiền lúc này",
        });
      }
    },
  });
};
