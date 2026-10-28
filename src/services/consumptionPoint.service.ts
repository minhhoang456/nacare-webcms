import { Prisma } from "@prisma/client";
import { prismaClient } from "../utils/prisma";
import redis from "../utils/redis";

type DatabaseClient = typeof prismaClient | any;

export type ConsumptionPointBalance = {
  total: number;
  reserved: number;
  available: number;
};

function point(value: bigint | number | null | undefined): number {
  const result = Number(value || 0);
  if (!Number.isSafeInteger(result)) {
    throw new Error(
      `consumption point is not a safe integer: ${String(value)}`,
    );
  }
  return result;
}

export function vietnamDate(timestamp = Date.now()): string {
  return new Date(timestamp + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function getConsumptionPointBalance(
  customerId: number,
  db: DatabaseClient = prismaClient,
): Promise<ConsumptionPointBalance> {
  const rows = (await db.$queryRaw(Prisma.sql`
    SELECT
      ledger."total"::bigint AS "total",
      reservation."reserved"::bigint AS "reserved",
      (ledger."total" - reservation."reserved")::bigint AS "available"
    FROM (
      SELECT COALESCE(SUM(
        CASE WHEN "direction" = 'credit' THEN "amount" ELSE -"amount" END
      ), 0)::bigint AS "total"
      FROM "consumptionPointTransaction"
      WHERE "customerId" = ${customerId}
    ) AS ledger
    CROSS JOIN (
      SELECT COALESCE(SUM("amount"), 0)::bigint AS "reserved"
      FROM "consumptionPointReservation"
      WHERE "customerId" = ${customerId} AND "status" = 'pending'
    ) AS reservation
  `)) as Array<{ total: bigint; reserved: bigint; available: bigint }>;
  return {
    total: point(rows[0]?.total),
    reserved: point(rows[0]?.reserved),
    available: point(rows[0]?.available),
  };
}

export async function reserveConsumptionPoint(
  tx: any,
  customerId: number,
  orderId: number,
  amount: number,
): Promise<void> {
  if (amount === 0) return;
  // Khóa customer để hai request tạo đơn đồng thời không cùng tiêu một số dư.
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM customer WHERE id = ${customerId} FOR UPDATE
  `);
  const balance = await getConsumptionPointBalance(customerId, tx);
  if (amount > balance.available) {
    throw new Error("e_consumption_point_not_enough");
  }
  const now = BigInt(Date.now());
  await tx.consumptionPointReservation.create({
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

export async function consumeReservedConsumptionPoint(
  tx: any,
  orderId: number,
  completedAt: number,
): Promise<number | null> {
  const reservation = await tx.consumptionPointReservation.findUnique({
    where: { orderId },
  });
  if (!reservation || reservation.status !== "pending") return null;

  await tx.consumptionPointTransaction.create({
    data: {
      idempotencyKey: `order-payment:${orderId}`,
      calculationDate: vietnamDate(completedAt),
      type: "order_payment",
      direction: "debit",
      customerId: reservation.customerId,
      sourceOrderId: BigInt(orderId),
      amount: reservation.amount,
      metadata: { orderId },
      createdAt: BigInt(completedAt),
    },
  });
  await tx.consumptionPointReservation.update({
    where: { orderId },
    data: { status: "consumed", updatedAt: BigInt(completedAt) },
  });
  return reservation.customerId;
}

export async function releaseReservedConsumptionPoint(
  tx: any,
  orderId: number,
): Promise<number | null> {
  const reservation = await tx.consumptionPointReservation.findUnique({
    where: { orderId },
  });
  if (!reservation || reservation.status !== "pending") return null;
  await tx.consumptionPointReservation.update({
    where: { orderId },
    data: { status: "released", updatedAt: BigInt(Date.now()) },
  });
  return reservation.customerId;
}

export async function clearConsumptionPointCache(
  customerIds: Iterable<number>,
): Promise<void> {
  const keys = Array.from(new Set(customerIds)).map(
    (customerId) => `customer_info_${customerId}`,
  );
  if (keys.length > 0) await redis.del(...keys);
}

export default {
  getConsumptionPointBalance,
  reserveConsumptionPoint,
  consumeReservedConsumptionPoint,
  releaseReservedConsumptionPoint,
  clearConsumptionPointCache,
};
