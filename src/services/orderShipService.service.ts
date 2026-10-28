import { prismaClient } from "../utils/prisma";
import paymentTransactionService from "./paymentTransaction.service";

export const orderShipService = {
  getListOrderShipsByAll: async (
    customerId: number,
    skip: number,
    limit: number,
    storeId?: number
  ) => {
    const rs = await Promise.all([
      prismaClient.ordership.findMany({
        skip,
        take: limit,
        where: {
          customerId: customerId,
          storeId: storeId,
          status: {
            in: [
              "wait_for_admin_confirm",
              "wait_for_confirmation",
              "pending",
              "shipping",
              "completed",
              "canceled",
              "returnOrder",
            ],
          },
          typeItem: "product",
        },
        orderBy: { createdAt: "desc" },
      }),
      prismaClient.ordership.count({
        where: {
          customerId: customerId,
          storeId: storeId,
          status: {
            in: [
              "wait_for_admin_confirm",
              "wait_for_confirmation",
              "pending",
              "shipping",
              "completed",
              "canceled",
              "returnOrder",
            ],
          },
          typeItem: "product",
        },
      }),
    ]);
    return rs;
  },

  getListOrderShipsByCustomer: async (params: {
    customerId: number;
    skip: number;
    limit: number;
    status?: string;
  }) => {
    const { customerId, status, skip, limit } = params;

    const criteria: any = { customerId, status, typeItem: "product" };

    const rs = await Promise.all([
      prismaClient.ordership.findMany({
        skip,
        take: limit,
        where: criteria,
        orderBy: {
          updatedAt: "desc",
        },
      }),
      prismaClient.ordership.count({
        where: criteria,
      }),
    ]);
    return rs;
  },

  refundOrderShip: async (orderShipInfo: any, reason?: string) => {
    try {
      if (orderShipInfo && orderShipInfo.paymentTransactionId) {
        const payTransactionInfo =
          await prismaClient.paymentTransaction.findFirst({
            where: { transactionId: orderShipInfo.paymentTransactionId },
          });
        if (payTransactionInfo) {
          await paymentTransactionService.refundSuccessfulPayment(
            payTransactionInfo,
            reason || "Hoàn tiền do hủy đơn vận chuyển"
          );
        }
      }

      if (orderShipInfo.discountVoucherId && orderShipInfo.discountCode) {
        // await voucherService.unlockCode({
        //   code: orderShipInfo.discountCode,
        //   voucherId: orderShipInfo.discountVoucherId,
        //   customerId: orderShipInfo.customerId,
        // });
      }
    } catch (error) {
      console.log("🚀 ~ refundOrderShip: ~ error:", error);
    }
  },
};
export default orderShipService;
