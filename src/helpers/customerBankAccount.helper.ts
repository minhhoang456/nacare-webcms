import { customerBankAccount, Prisma } from "@prisma/client";
import { FastifyReply } from "fastify";
import { z } from "zod";

export const bankFields = z.object({
  bankName: z.string().trim().min(1).max(255),
  bankCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((value) => value.toUpperCase()),
  bankAccountNumber: z.string().trim().min(3).max(64),
});

export const bankAccountParams = z.object({
  bankAccountId: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),
});

export function customerIdFromRequest(req: any): number | null {
  const customerId = Number(req.customerId);
  return Number.isSafeInteger(customerId) && customerId > 0 ? customerId : null;
}

export function publicBankAccount(account: customerBankAccount) {
  return {
    id: account.id,
    bankName: account.bankName,
    bankCode: account.bankCode,
    bankAccountNumber: account.bankAccountNumber,
    isDefault: account.isDefault,
    createdAt: account.createdAt === null ? null : Number(account.createdAt),
    updatedAt: account.updatedAt === null ? null : Number(account.updatedAt),
  };
}

export function sendBankAccountFailure(
  req: any,
  res: FastifyReply,
  error: unknown,
) {
  req.log?.error?.(error);
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return res
      .code(409)
      .send({ code: 1, message: "Tài khoản ngân hàng đã được lưu" });
  }
  return res.code(500).send({
    code: 1,
    message: "Không thể xử lý sổ tài khoản ngân hàng lúc này",
  });
}
