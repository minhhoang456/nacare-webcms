// Pure helpers for admin pool adjustments. No Prisma import or DB connection.
export const LEGACY_ACCUMULATION_ORDER_SOURCE = "legacy_accumulation_import";

export function businessDateFromTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) throw new Error("invalid timestamp");
  return new Date(timestamp + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function manualPoolAfterAdjustment(
  current: bigint,
  amount: number,
): bigint | null {
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new Error("manual pool adjustment must be a non-zero safe integer");
  }
  const next = current + BigInt(amount);
  if (next < BigInt(0)) return null;
  if (!Number.isSafeInteger(Number(next))) {
    throw new Error("manual pool total exceeds safe integer range");
  }
  return next;
}
