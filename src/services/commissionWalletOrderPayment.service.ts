import { Prisma } from "@prisma/client";
import { prismaClient } from "../utils/prisma";
import { vietnamDate } from "./consumptionPoint.service";

type DatabaseClient = Pick<typeof prismaClient, "$queryRaw">;

function safeAmount(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) {
    throw new Error("Số dư hoa hồng vượt giới hạn số nguyên an toàn");
  }
  return amount;
}

// Số khả dụng dùng chung cho mua hàng và các thao tác trừ ví. Bao gồm cả
// yêu cầu rút cũ chưa có bút toán debit và các đơn đang chờ thanh toán.
export async function getCommissionWalletAvailable(
  customerId: number,
  db: DatabaseClient = prismaClient,
): Promise<number> {
  const rows = await db.$queryRaw<
    Array<{ availableAmount: bigint }>
  >(Prisma.sql`
    SELECT (
      COALESCE((
        SELECT "balance" - "reservedAmount"
        FROM "commissionWallet"
        WHERE "customerId" = ${customerId} AND "walletType" = 'total'
      ), 0)
      - COALESCE((
        SELECT SUM(w."amount") FROM "commissionWithdrawal" w
        WHERE w."customerId" = ${customerId} AND w."status" = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM "commissionTransaction" t
            WHERE t."idempotencyKey" = 'withdrawal:' || w."id"::text
              AND t."customerId" = w."customerId"
              AND t."type" = 'withdrawal' AND t."direction" = 'debit'
          )
      ), 0)
      - COALESCE((
        SELECT SUM(r."amount") FROM "commissionWalletOrderReservation" r
        WHERE r."customerId" = ${customerId} AND r."status" = 'pending'
      ), 0)
    )::bigint AS "availableAmount"
  `);
  return safeAmount(rows[0]?.availableAmount ?? BigInt(0));
}

export async function reserveCommissionWalletForOrder(
  tx: any,
  customerId: number,
  orderId: number,
  amount: number,
): Promise<void> {
  if (amount === 0) return;
  // Cùng khóa với lệnh rút, điều chỉnh trừ ví và trigger đồng bộ ví.
  await tx.$queryRaw(Prisma.sql`
    SELECT 1 FROM pg_advisory_xact_lock(170614, ${customerId})
  `);
  if (amount > (await getCommissionWalletAvailable(customerId, tx))) {
    throw new Error("e_commission_wallet_not_enough");
  }
  const now = BigInt(Date.now());
  await tx.commissionWalletOrderReservation.create({
    data: {
      orderId,
      customerId,
      amount: BigInt(amount),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    },
  });
}

export async function consumeReservedCommissionWallet(
  tx: any,
  orderId: number,
  completedAt: number,
): Promise<void> {
  const reservation = await tx.commissionWalletOrderReservation.findUnique({
    where: { orderId },
  });
  if (!reservation || reservation.status !== "pending") return;
  await tx.commissionTransaction.create({
    data: {
      idempotencyKey: `order-payment-commission:${orderId}`,
      calculationDate: vietnamDate(completedAt),
      type: "order_payment",
      direction: "debit",
      customerId: reservation.customerId,
      sourceOrderId: BigInt(orderId),
      grossAmount: reservation.amount,
      deductionAmount: reservation.amount,
      netAmount: BigInt(0),
      amount: reservation.amount,
      metadata: {
        orderId,
        content: `Dùng ${safeAmount(reservation.amount).toLocaleString("vi-VN")}đ ví hoa hồng thanh toán đơn hàng #${orderId}`,
      },
      createdAt: BigInt(completedAt),
    },
  });
  await tx.commissionWalletOrderReservation.update({
    where: { orderId },
    data: { status: "consumed", updatedAt: BigInt(completedAt) },
  });
}

export async function releaseReservedCommissionWallet(
  tx: any,
  orderId: number,
): Promise<void> {
  const reservation = await tx.commissionWalletOrderReservation.findUnique({
    where: { orderId },
  });
  if (!reservation || reservation.status !== "pending") return;
  await tx.commissionWalletOrderReservation.update({
    where: { orderId },
    data: { status: "released", updatedAt: BigInt(Date.now()) },
  });
}
