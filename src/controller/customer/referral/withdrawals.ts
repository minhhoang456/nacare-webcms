import { Prisma } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@src/utils/prisma";
import {
  getWithdrawalTaxBreakdown,
  WITHDRAWAL_TAX_PERCENT,
} from "@root/src/helpers/withdrawalTax.helper";
import { getCommissionWalletAvailable } from "@root/src/services/commissionWalletOrderPayment.service";

const createWithdrawalSchema = z.object({
  bankName: z.string().trim().min(1).max(255),
  bankCode: z.string().trim().min(1).max(64),
  bankAccountNumber: z.string().trim().min(3).max(64),
  phoneNumber: z.string().trim().min(8).max(32),
  amount: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const listWithdrawalSchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

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
    method: "GET",
    url: "/withdrawals",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Customer - Lịch sử yêu cầu rút tiền hoa hồng",
      querystring: listWithdrawalSchema,
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = Number(req.customerId);
      if (!Number.isSafeInteger(customerId) || customerId <= 0) {
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      }

      const { skip, limit } = req.query;
      try {
        const [items, total] = await Promise.all([
          prismaClient.commissionWithdrawal.findMany({
            where: { customerId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip,
            take: limit,
          }),
          prismaClient.commissionWithdrawal.count({ where: { customerId } }),
        ]);

        return res.send({
          code: 0,
          message: "Thành công",
          data: {
            items: items.map((item) => ({
              id: money(item.id),
              bankName: item.bankName,
              bankCode: item.bankCode,
              bankAccountNumber: item.bankAccountNumber,
              phoneNumber: item.phoneNumber,
              amount: money(item.amount),
              taxPercent: item.taxPercent ?? 0,
              taxAmount: money(
                item.amount - (item.receivedAmount ?? item.amount),
              ),
              receivedAmount: money(item.receivedAmount ?? item.amount),
              status: item.status,
              createdAt: money(item.createdAt),
              updatedAt: money(item.updatedAt),
            })),
            total,
            skip,
            limit,
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể lấy lịch sử rút tiền lúc này",
        });
      }
    },
  });

  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/withdrawals",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Customer - Tạo yêu cầu rút tiền hoa hồng",
      description:
        "Ghi nợ hoa hồng ngay khi tạo yêu cầu; admin từ chối sẽ ghi bút toán hoàn.",
      body: createWithdrawalSchema,
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = Number(req.customerId);
      if (!Number.isSafeInteger(customerId) || customerId <= 0) {
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      }

      const customer = await prismaClient.customer.findUnique({
        where: { id: customerId },
        select: { cccd: true, cccdFrontImage: true, cccdBackImage: true },
      });
      if (
        !customer?.cccd?.trim() ||
        !customer?.cccdFrontImage?.trim() ||
        !customer?.cccdBackImage?.trim()
      ) {
        return res.code(422).send({
          code: 2,
          message:
            "Vui lòng cập nhật thông tin căn cước công dân trước khi rút tiền",
        });
      }

      const { bankName, bankCode, bankAccountNumber, phoneNumber, amount } =
        req.body;
      const { taxAmount, receivedAmount } = getWithdrawalTaxBreakdown(amount);

      try {
        const result = await prismaClient.$transaction(async (tx) => {
          // Cùng khóa với trigger ví: hai yêu cầu đồng thời không thể rút
          // cùng một phần số dư.
          await tx.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
            SELECT 1 AS locked FROM pg_advisory_xact_lock(170614, ${customerId})
          `);
          const availableAmount = await getCommissionWalletAvailable(
            customerId,
            tx,
          );
          if (amount > availableAmount) return null;

          const withdrawal = await tx.commissionWithdrawal.create({
            data: {
              customerId,
              bankName,
              bankCode: bankCode.toUpperCase(),
              bankAccountNumber,
              phoneNumber,
              amount: BigInt(amount),
              taxPercent: WITHDRAWAL_TAX_PERCENT,
              receivedAmount,
            },
          });
          await tx.commissionTransaction.create({
            data: {
              idempotencyKey: `withdrawal:${String(withdrawal.id)}`,
              runId: null,
              calculationDate: getVietnamDate(),
              type: "withdrawal",
              direction: "debit",
              customerId,
              grossAmount: BigInt(availableAmount),
              deductionAmount: BigInt(amount),
              netAmount: BigInt(availableAmount - amount),
              amount: BigInt(amount),
              metadata: {
                withdrawalId: String(withdrawal.id),
                action: "request",
                content: `Rút ${amount.toLocaleString("vi-VN")}đ tiền hoa hồng; thuế TNCN ${WITHDRAWAL_TAX_PERCENT}%: ${money(taxAmount).toLocaleString("vi-VN")}đ; thực nhận ${money(receivedAmount).toLocaleString("vi-VN")}đ`,
              },
              createdAt: BigInt(Date.now()),
            },
          });
          return { withdrawal, availableAmount: availableAmount - amount };
        });
        if (!result) {
          return res.code(422).send({
            code: 1,
            message: "Số tiền rút vượt quá số dư hoa hồng hiện có",
          });
        }

        const { withdrawal, availableAmount } = result;

        return res.send({
          code: 0,
          message: "Đã tạo yêu cầu và trừ tiền hoa hồng, chờ xác nhận",
          data: {
            id: money(withdrawal.id),
            bankName: withdrawal.bankName,
            bankCode: withdrawal.bankCode,
            bankAccountNumber: withdrawal.bankAccountNumber,
            phoneNumber: withdrawal.phoneNumber,
            amount: money(withdrawal.amount),
            taxPercent: withdrawal.taxPercent ?? 0,
            taxAmount: money(taxAmount),
            receivedAmount: money(receivedAmount),
            availableAmount,
            status: withdrawal.status,
            createdAt: money(withdrawal.createdAt),
            updatedAt: money(withdrawal.updatedAt),
          },
        });
      } catch (error) {
        req.log?.error?.(error);
        return res.code(500).send({
          code: 1,
          message: "Không thể tạo yêu cầu rút tiền lúc này",
        });
      }
    },
  });
};
