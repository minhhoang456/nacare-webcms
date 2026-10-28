import moment from "moment";
import { prismaClient } from "../utils/prisma";
import {
  OrderPaymentStatusEnum,
  PaymentMethodEnum,
  PaymentProcessTimeoutStatusEnum,
  PaymentStatusEnum,
} from "@prisma/client";
import orderProductHelper from "../helpers/orderProduct.helper";
import itemService from "./item.service";
import vnpayHelper from "../helpers/vnpay.helper";
import { PaymentGateway } from "../types/enums";
import { VNPayRefundRequest } from "../types/vnpay.type";
import commissionRealtimeService from "./commissionRealtime.service";
import Conf from "./conf";
import {
  clearConsumptionPointCache,
  releaseReservedConsumptionPoint,
} from "./consumptionPoint.service";
import { releaseReservedCommissionWallet } from "./commissionWalletOrderPayment.service";

function calculateCommissionAfterPayment(orderIds: number[]): void {
  // Hoa hồng không nằm trong transaction IPN để lỗi service tính toán không
  // làm giao dịch thanh toán thành công bị hoàn tiền nhầm. Cron mỗi phút sẽ
  // quét bù nếu tiến trình này lỗi hoặc backend dừng giữa chừng.
  void Promise.allSettled(
    orderIds.map((orderId) =>
      commissionRealtimeService.processCompletedOrder(orderId),
    ),
  ).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Realtime commission calculation failed:", result.reason);
      }
    }
  });
}

export const paymentTransactionService = {
  bootstrap: async () => {
    // await testCreateOrder();
    // await testPayQuery('241221_test_1734770347198');
    // paymentTransactionService.processRefundTimeout();
  },
  runCronjob5: async () => {
    // await paymentTransactionService.processPaymentTimeout();
    // await paymentTransactionService.processAbandonedOrderReservations();
    // await paymentTransactionService.processRefundTimeout();
  },

  processAbandonedOrderReservations: async () => {
    const cutoff = BigInt(
      Date.now() - Conf.get("TIMEOUT_PAY_MINUTES", 15) * 60_000,
    );
    const [pointHolds, commissionHolds] = await Promise.all([
      prismaClient.consumptionPointReservation.findMany({
        where: { status: "pending", createdAt: { lte: cutoff } },
        select: { orderId: true },
        orderBy: { createdAt: "asc" },
        take: 500,
      }),
      prismaClient.commissionWalletOrderReservation.findMany({
        where: { status: "pending", createdAt: { lte: cutoff } },
        select: { orderId: true },
        orderBy: { createdAt: "asc" },
        take: 500,
      }),
    ]);
    const orderIds = new Set([
      ...pointHolds.map((hold) => hold.orderId),
      ...commissionHolds.map((hold) => hold.orderId),
    ]);
    for (const orderId of orderIds) {
      try {
        const order = await prismaClient.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            customerId: true,
            requestId: true,
            paymentStatus: true,
          },
        });
        if (!order) continue;
        if (order.paymentStatus === OrderPaymentStatusEnum.canceled) {
          const changedPointCustomerId = await prismaClient.$transaction(
            async (tx) => {
              await releaseReservedCommissionWallet(tx, orderId);
              return releaseReservedConsumptionPoint(tx, orderId);
            },
          );
          if (changedPointCustomerId)
            await clearConsumptionPointCache([changedPointCustomerId]);
          continue;
        }
        if (order.paymentStatus !== OrderPaymentStatusEnum.processing) continue;
        let payment = await prismaClient.paymentTransaction.findFirst({
          where: { orderId },
          orderBy: { id: "desc" },
        });
        if (!payment && order.requestId) {
          const summary = await prismaClient.order.findFirst({
            where: { requestId: order.requestId, isMultiStore: true },
            orderBy: { id: "desc" },
            select: { id: true },
          });
          if (summary) {
            payment = await prismaClient.paymentTransaction.findFirst({
              where: { orderId: summary.id },
              orderBy: { id: "desc" },
            });
          }
        }
        if (payment?.status === PaymentStatusEnum.processing) {
          if (Number(payment.timeout || 0) <= Date.now()) {
            await paymentTransactionService.handleTimeoutPay(payment);
          }
          continue;
        }
        if (payment?.status === PaymentStatusEnum.success) continue;
        // Không tạo giao dịch thanh toán, hoặc giao dịch đã thất bại: hủy đơn
        // để nhả cả điểm và hoa hồng đã giữ.
        await paymentTransactionService.processFailedTransaction({ orderId });
      } catch (error) {
        console.error(`Cannot release abandoned order ${orderId}:`, error);
      }
    }
  },

  processPaymentTimeout: async () => {
    try {
      const currentTime = moment().valueOf();
      const pendingTransactions =
        await prismaClient.paymentTransaction.findMany({
          where: {
            status: PaymentStatusEnum.processing,
            paymentMethod: PaymentMethodEnum.pay,
            processTimeoutStatus: {
              in: [
                PaymentProcessTimeoutStatusEnum.none,
                PaymentProcessTimeoutStatusEnum.processing,
              ],
            },
            timeout: { lte: currentTime },
            retry: { lt: 3 },
          },
        });
      const results = await Promise.allSettled(
        pendingTransactions.map((transaction) =>
          paymentTransactionService.handleTimeoutPay(transaction),
        ),
      );
      const failedTransactions = results.filter(
        (result) => result.status === "rejected",
      );

      if (failedTransactions.length > 0) {
        console.error(
          `Failed to process timeout transactions: ${failedTransactions.length} `,
        );
      }
    } catch (error: any) {
      console.log(
        "🚀 ~ paymentTransaction.processTimeoutException:",
        error.message,
      );
    }
  },

  processRefundTimeout: async () => {
    try {
      const currentTime = moment().valueOf();
      const pendingTransactions =
        await prismaClient.paymentTransaction.findMany({
          where: {
            status: PaymentStatusEnum.processing,
            paymentMethod: PaymentMethodEnum.refund,
            processTimeoutStatus: {
              in: [
                PaymentProcessTimeoutStatusEnum.none,
                PaymentProcessTimeoutStatusEnum.processing,
              ],
            },
            timeout: { gte: currentTime },
            retry: { lt: 3 },
          },
        });
      const results = await Promise.allSettled(
        pendingTransactions.map((transaction) =>
          paymentTransactionService.handleTimeoutPay(transaction),
        ),
      );
      const failedTransactions = results.filter(
        (result) => result.status === "rejected",
      );

      if (failedTransactions.length > 0) {
        console.error(
          `Failed to process timeout transactions: ${failedTransactions.length} `,
        );
      }
    } catch (error: any) {
      console.log(
        "🚀 ~ paymentTransaction.processTimeoutException:",
        error.message,
      );
    }
  },

  handleTimeoutPay: async (transaction: any) => {
    try {
      await updateTransactionAndOrder({
        transaction,
        status: PaymentStatusEnum.failed,
        orderStatus: OrderPaymentStatusEnum.canceled,
        retries: 1,
      });
    } catch (error) {
      console.error(
        `Final failure for timeout transaction ${transaction.id}:`,
        error,
      );
    }
  },

  refundSuccessfulPayment: async (transaction: any, reason: string) => {
    if (transaction.paymentMethod !== PaymentMethodEnum.pay) {
      return {
        isRefundSuccess: false,
        message: "Giao dịch không phải giao dịch thanh toán",
      };
    }
    if (transaction.status === PaymentStatusEnum.refunded) {
      return {
        isRefundSuccess: true,
        message: "Giao dịch đã được hoàn tiền",
      };
    }
    if (transaction.status === PaymentStatusEnum.refund) {
      return {
        isRefundSuccess: false,
        message: "Giao dịch đang được hoàn tiền",
      };
    }
    if (transaction.status !== PaymentStatusEnum.success) {
      return {
        isRefundSuccess: false,
        message: "Giao dịch chưa thanh toán thành công",
      };
    }

    return paymentTransactionService.refundPayment(transaction, reason);
  },

  compensateSuccessfulPayment: async (transaction: any, reason: string) => {
    return paymentTransactionService.refundPayment(transaction, reason);
  },

  refundPayment: async (transaction: any, reason: string) => {
    const refundClaim = await prismaClient.paymentTransaction.updateMany({
      where: {
        id: transaction.id,
        status: PaymentStatusEnum.success,
      },
      data: {
        status: PaymentStatusEnum.refund,
        error_code: reason,
      },
    });
    if (refundClaim.count === 0) {
      const currentTransaction =
        await prismaClient.paymentTransaction.findUnique({
          where: { id: transaction.id },
          select: { status: true },
        });
      return {
        isRefundSuccess:
          currentTransaction?.status === PaymentStatusEnum.refunded,
        message:
          currentTransaction?.status === PaymentStatusEnum.refunded
            ? "Giao dịch đã được hoàn tiền"
            : "Giao dịch đang được hoàn tiền",
      };
    }

    const transactionForRefund =
      await prismaClient.paymentTransaction.findUnique({
        where: { id: transaction.id },
      });
    if (!transactionForRefund) {
      return {
        isRefundSuccess: false,
        message: "Không tìm thấy giao dịch hoàn tiền",
      };
    }

    switch (transactionForRefund.partner) {
      case PaymentGateway.VNPAY:
      case "vnpay":
        return paymentTransactionService.refundVnpayTransaction(
          transactionForRefund,
          reason,
        );
      default:
        return {
          isRefundSuccess: false,
          message: "Cổng thanh toán không hỗ trợ hoàn tiền tự động",
        };
    }
  },

  refundVnpayTransaction: async (transaction: any, reason: string) => {
    if (!transaction.totalAmmount) {
      return {
        isRefundSuccess: false,
        message: "Không xác định được số tiền hoàn trả",
      };
    }

    try {
      const config = vnpayHelper.getConfig();
      const ipnData =
        typeof transaction.ipn === "object" && transaction.ipn !== null
          ? transaction.ipn
          : {};

      const createDate = moment().format("YYYYMMDDHHmmss");
      const transactionDate =
        ipnData.vnp_PayDate ||
        (transaction.createdAt
          ? moment(Number(transaction.createdAt)).format("YYYYMMDDHHmmss")
          : createDate);

      const refundRequest: VNPayRefundRequest = {
        requestId: `${moment().format("YYMMDDHHmmss")}_${Math.floor(1000 + Math.random() * 9000)}`,
        transactionType: "02",
        txnRef: transaction.transactionId,
        amount: transaction.totalAmmount,
        transactionNo: ipnData.vnp_TransactionNo || "",
        transactionDate,
        createBy: "system",
        createDate,
        ipAddr: ipnData.vnp_IpAddr || "",
        orderInfo: reason || `Hoàn tiền giao dịch ${transaction.transactionId}`,
      };

      const response = await vnpayHelper.refundTransaction(
        refundRequest,
        config,
      );
      const isRefundSuccess = response.vnp_ResponseCode === "00";

      await prismaClient.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: isRefundSuccess
            ? PaymentStatusEnum.refunded
            : PaymentStatusEnum.refund_err,
          error_code: response.vnp_Message || reason,
          refundTransId: response.vnp_ResponseId,
          lastQuery: response as any,
          lastQueryAt: Date.now(),
        },
      });

      return {
        isRefundSuccess,
        message:
          response.vnp_Message ||
          (isRefundSuccess ? "Hoàn tiền thành công" : "Hoàn tiền thất bại"),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Hoàn tiền thất bại";
      await prismaClient.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: PaymentStatusEnum.refund_err,
          error_code: errorMessage,
          lastQueryAt: Date.now(),
        },
      });

      return {
        isRefundSuccess: false,
        message: errorMessage,
      };
    }
  },

  processSuccessfulTransaction: async (payTransactionInfo: any) => {
    const orderInfo = await prismaClient.order.findUnique({
      where: { id: payTransactionInfo.orderId },
      select: { id: true },
    });
    if (!orderInfo) return;

    await completeInventoryHolding([orderInfo.id]);
    await orderProductHelper.updateStatusOrderProduct({
      orderId: orderInfo.id,
      // Không còn bước xác nhận/vận chuyển: IPN thành công hoàn tất đơn ngay.
      status: OrderPaymentStatusEnum.completed,
    });
    calculateCommissionAfterPayment([orderInfo.id]);
  },
  processSuccessfulTransactionMultiStore: async (payTransactionInfo: any) => {
    const summaryOrder = await prismaClient.order.findUnique({
      where: { id: payTransactionInfo.orderId },
      select: { requestId: true },
    });
    if (!summaryOrder?.requestId) return;

    const orderInfos = await prismaClient.order.findMany({
      where: {
        requestId: summaryOrder.requestId,
        isMultiStore: false,
        paymentStatus: OrderPaymentStatusEnum.processing,
      },
      select: { id: true },
    });
    const orderIds = orderInfos.map((orderInfo) => orderInfo.id);
    await completeInventoryHolding(orderIds);
    await Promise.all(
      orderIds.map((orderId) =>
        orderProductHelper.updateStatusOrderProduct({
          orderId,
          status: OrderPaymentStatusEnum.completed,
        }),
      ),
    );
    calculateCommissionAfterPayment(orderIds);
  },

  processFailedTransaction: async (payTransactionInfo: any) => {
    const orderInfo = await prismaClient.order.findUnique({
      where: { id: payTransactionInfo.orderId },
      select: { id: true, isMultiStore: true, requestId: true },
    });
    if (!orderInfo) return;

    const orderIds =
      orderInfo.isMultiStore && orderInfo.requestId
        ? (
            await prismaClient.order.findMany({
              where: {
                requestId: orderInfo.requestId,
                isMultiStore: false,
                paymentStatus: OrderPaymentStatusEnum.processing,
              },
              select: { id: true },
            })
          ).map((order) => order.id)
        : [orderInfo.id];

    await rollbackInventoryHolding(orderIds);
    await Promise.all(
      orderIds.map((orderId) =>
        orderProductHelper.updateStatusOrderProduct({
          orderId,
          status: OrderPaymentStatusEnum.canceled,
        }),
      ),
    );
  },
};
export default paymentTransactionService;

async function updateTransactionAndOrder({
  transaction,
  status,
  vttTransactionId,
  orderStatus,
  retries,
}: {
  transaction: any;
  status: PaymentStatusEnum;
  vttTransactionId?: string;
  orderStatus: OrderPaymentStatusEnum;
  retries: number;
}) {
  const dataUpdate: any = {
    status: status,
    processTimeoutStatus: PaymentProcessTimeoutStatusEnum.done,
    retry: retries,
  };
  if (vttTransactionId) {
    dataUpdate.vttTransactionId = vttTransactionId;
  }
  const updatedTransaction = await prismaClient.paymentTransaction.update({
    where: { id: transaction.id },
    data: dataUpdate,
  });
  if (orderStatus === OrderPaymentStatusEnum.canceled) {
    await paymentTransactionService.processFailedTransaction(
      updatedTransaction,
    );
  }
}

async function getInventoryItemsByOrderIds(orderIds: number[]) {
  if (orderIds.length === 0) return [];

  const orderItems = await prismaClient.orderitem.findMany({
    where: {
      orderId: { in: orderIds },
      itemId: { not: null },
      quantity: { gt: 0 },
    },
    select: { itemId: true, quantity: true },
  });
  const quantityByItemId = new Map<number, number>();
  orderItems.forEach((orderItem) => {
    if (!orderItem.itemId || !orderItem.quantity) return;
    const itemId = Number(orderItem.itemId);
    const currentQuantity = quantityByItemId.get(itemId) || 0;
    quantityByItemId.set(itemId, currentQuantity + orderItem.quantity);
  });
  return Array.from(quantityByItemId, ([itemId, quantity]) => ({
    itemId,
    quantity,
  }));
}

async function completeInventoryHolding(orderIds: number[]) {
  const inventoryItems = await getInventoryItemsByOrderIds(orderIds);
  await Promise.all(
    inventoryItems.map(({ itemId, quantity }) =>
      itemService.completeHoldingByItemId(itemId, quantity),
    ),
  );
}

async function rollbackInventoryHolding(orderIds: number[]) {
  const inventoryItems = await getInventoryItemsByOrderIds(orderIds);
  if (inventoryItems.length === 0) return;
  await itemService.rollbackHolding(inventoryItems);
}
