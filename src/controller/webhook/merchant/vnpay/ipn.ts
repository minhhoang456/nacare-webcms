import { PaymentStatusEnum, Prisma } from "@prisma/client";
import vnpayHelper from "@root/src/helpers/vnpay.helper";
import { prismaClient } from "@root/src/utils/prisma";
import { paymentTransactionService } from "@src/services";
import { FastifyInstance } from "fastify";

export default async (fastify: FastifyInstance) => {
  fastify.route({
    method: "GET",
    url: `/ipn`,
    handler: async (req, res) => {
      try {
        const query = req.query as any;

        // 1. Xác thực chữ ký
        const isValid = await vnpayHelper.verifySignature({ ...query });
        if (!isValid) {
          return res
            .status(200)
            .send({ RspCode: "97", Message: "Invalid Checksum" });
        }

        const txnRef = query.vnp_TxnRef;
        const amount = Number(query.vnp_Amount) / 100;
        const responseCode = query.vnp_ResponseCode;
        const transactionStatus = query.vnp_TransactionStatus;

        // 2. Giao dịch thành công khi responseCode = "00" và transactionStatus = "00"
        const isSuccessfulResult =
          responseCode === "00" && transactionStatus === "00";

        // 3. Cập nhật transaction trong database
        const transactionResult = await prismaClient.$transaction(
          async (tx) => {
            const paymentTransaction = await tx.paymentTransaction.findFirst({
              where: {
                OR: [
                  { transactionId: txnRef },
                  ...(Number.isInteger(Number(txnRef)) && Number(txnRef) > 0
                    ? [{ id: Number(txnRef) }]
                    : []),
                ],
                paymentMethod: "pay",
              },
              orderBy: { id: "desc" },
            });

            if (!paymentTransaction) {
              return { rspCode: "01", message: "Order not found" };
            }

            // Kiểm tra số tiền
            if (paymentTransaction.totalAmmount !== amount) {
              return { rspCode: "04", message: "Invalid amount" };
            }

            const nextStatus = isSuccessfulResult
              ? PaymentStatusEnum.success
              : PaymentStatusEnum.failed;

            // Nếu đơn đã được xử lý trước đó
            if (
              paymentTransaction.status === PaymentStatusEnum.success ||
              paymentTransaction.status === PaymentStatusEnum.failed
            ) {
              return {
                rspCode: "02",
                message: "Order already confirmed",
                paymentTransaction,
                shouldProcessOrder: false,
              };
            }

            if (paymentTransaction.status !== PaymentStatusEnum.processing) {
              return {
                rspCode: "02",
                message: "Order already confirmed",
                paymentTransaction,
                shouldProcessOrder: false,
              };
            }

            const updatedPaymentTransaction =
              await tx.paymentTransaction.update({
                where: { id: paymentTransaction.id },
                data: {
                  status: nextStatus,
                  error_code: responseCode,
                  ipn: query,
                  ipnAt: Date.now(),
                  processTimeoutStatus: "done",
                  bankCode: query.vnp_BankCode || paymentTransaction.bankCode,
                },
              });

            return {
              rspCode: "00",
              message: "Confirm Success",
              paymentTransaction: updatedPaymentTransaction,
              shouldProcessOrder: true,
            };
          },
          {
            maxWait: 5000,
            timeout: 10000,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        if (!transactionResult.shouldProcessOrder) {
          return res.status(200).send({
            RspCode: transactionResult.rspCode,
            Message: transactionResult.message,
          });
        }

        const { paymentTransaction } = transactionResult;
        if (paymentTransaction) {
          const order = await prismaClient.order.findUnique({
            where: { id: paymentTransaction.orderId },
            select: { isMultiStore: true },
          });

          if (!isSuccessfulResult) {
            await paymentTransactionService.processFailedTransaction(
              paymentTransaction,
            );
          } else {
            try {
              if (order?.isMultiStore) {
                await paymentTransactionService.processSuccessfulTransactionMultiStore(
                  paymentTransaction,
                );
              } else {
                await paymentTransactionService.processSuccessfulTransaction(
                  paymentTransaction,
                );
              }
            } catch (error) {
              req.log.error(
                { error, paymentTransactionId: paymentTransaction.id },
                "Failed to process successful order in IPN",
              );
              await paymentTransactionService.refundPayment(
                paymentTransaction,
                "Hoàn tiền do lỗi xử lý đơn hàng",
              );
              throw error;
            }
          }
        }

        return res.status(200).send({
          RspCode: "00",
          Message: "Confirm Success",
        });
      } catch (error) {
        req.log.error(error, "VNPay IPN error");
        return res
          .status(200)
          .send({ RspCode: "99", Message: "Unknown error" });
      }
    },
  });
};
