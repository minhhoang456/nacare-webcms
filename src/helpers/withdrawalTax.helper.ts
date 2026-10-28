export const WITHDRAWAL_TAX_PERCENT = 10;

export function getWithdrawalTaxBreakdown(amount: number): {
  taxAmount: bigint;
  receivedAmount: bigint;
} {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("invalid_withdrawal_amount");
  }

  const grossAmount = BigInt(amount);
  // Làm tròn thuế tới đồng gần nhất, tránh sai số dấu phẩy động.
  const taxAmount =
    (grossAmount * BigInt(WITHDRAWAL_TAX_PERCENT) + BigInt(50)) / BigInt(100);
  return { taxAmount, receivedAmount: grossAmount - taxAmount };
}
