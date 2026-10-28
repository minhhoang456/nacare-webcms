import { Prisma } from "@prisma/client";
import { prismaClient } from "@src/utils/prisma";

type BankFields = {
  bankName: string;
  bankCode: string;
  bankAccountNumber: string;
};

async function lockOwner(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  customerId: number,
) {
  const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT id FROM customer WHERE id = ${customerId} FOR UPDATE
  `);
  if (rows.length !== 1) throw new Error("customer_not_found");
}

const customerBankAccountService = {
  list(customerId: number) {
    return prismaClient.customerBankAccount.findMany({
      where: { customerId },
      orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    });
  },

  create(customerId: number, fields: BankFields & { isDefault?: boolean }) {
    return prismaClient.$transaction(async (tx) => {
      await lockOwner(tx, customerId);
      const count = await tx.customerBankAccount.count({
        where: { customerId },
      });
      if (count >= 5) return null;

      const isDefault = count === 0 || fields.isDefault === true;
      if (isDefault && count > 0) {
        await tx.customerBankAccount.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false, updatedAt: BigInt(Date.now()) },
        });
      }
      return tx.customerBankAccount.create({
        data: {
          customerId,
          bankName: fields.bankName,
          bankCode: fields.bankCode,
          bankAccountNumber: fields.bankAccountNumber,
          isDefault,
          createdAt: BigInt(Date.now()),
          updatedAt: BigInt(Date.now()),
        },
      });
    });
  },

  update(
    customerId: number,
    bankAccountId: number,
    fields: Partial<BankFields>,
  ) {
    return prismaClient.$transaction(async (tx) => {
      await lockOwner(tx, customerId);
      const existing = await tx.customerBankAccount.findFirst({
        where: { id: bankAccountId, customerId },
      });
      if (!existing) return null;
      return tx.customerBankAccount.update({
        where: { id: existing.id },
        data: { ...fields, updatedAt: BigInt(Date.now()) },
      });
    });
  },

  setDefault(customerId: number, bankAccountId: number) {
    return prismaClient.$transaction(async (tx) => {
      await lockOwner(tx, customerId);
      const existing = await tx.customerBankAccount.findFirst({
        where: { id: bankAccountId, customerId },
      });
      if (!existing) return null;
      if (existing.isDefault) return existing;
      await tx.customerBankAccount.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false, updatedAt: BigInt(Date.now()) },
      });
      return tx.customerBankAccount.update({
        where: { id: existing.id },
        data: { isDefault: true, updatedAt: BigInt(Date.now()) },
      });
    });
  },

  remove(customerId: number, bankAccountId: number) {
    return prismaClient.$transaction(async (tx) => {
      await lockOwner(tx, customerId);
      const existing = await tx.customerBankAccount.findFirst({
        where: { id: bankAccountId, customerId },
      });
      if (!existing) return false;
      await tx.customerBankAccount.delete({ where: { id: existing.id } });
      if (existing.isDefault) {
        const replacement = await tx.customerBankAccount.findFirst({
          where: { customerId },
          orderBy: { id: "asc" },
        });
        if (replacement) {
          await tx.customerBankAccount.update({
            where: { id: replacement.id },
            data: { isDefault: true, updatedAt: BigInt(Date.now()) },
          });
        }
      }
      return true;
    });
  },
};

export default customerBankAccountService;
