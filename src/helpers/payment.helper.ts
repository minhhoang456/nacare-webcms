import Conf from "@src/services/conf";
import crypto from "crypto";
import moment from "moment";
import { PaymentGateway } from "../types/enums";
import { prismaClient } from "../utils/prisma";
import vnpayHelper from "./vnpay.helper";

const paymentHelper = {
  generateUniqueTransaction: (): string => {
    const prefix = "NACARE";
    const dateStr = moment().format("YYMMDD");
    const randomStr = crypto.randomBytes(3).toString("hex").toUpperCase();
    return `${prefix}_${dateStr}_${randomStr}`;
  },

  handleOnlinePayment: async (
    orderInfo: any,
    paymentGateway: PaymentGateway,
    { callbackUrl, ipAddr }: { callbackUrl?: string; ipAddr?: string } = {},
  ) => {
    let paymentUrl = "";
    return prismaClient.$transaction(async (tnx: any) => {
      const timeoutMinutes = Conf.get("TIMEOUT_PAY_MINUTES", 15);
      const transactionId = paymentHelper.generateUniqueTransaction();
      const payment = await paymentHelper.createPaymentTransaction(
        tnx,
        orderInfo,
        transactionId,
        timeoutMinutes,
        paymentGateway,
      );
      switch (paymentGateway) {
        case PaymentGateway.VNPAY:
          const config = vnpayHelper.getConfig();
          const data = {
            ipAddr: ipAddr || "",
            txnRef: payment.transactionId,
            transAmount: orderInfo.moneyPaid ?? orderInfo.totalMoney,
            description: `Thanh toán cho đơn hàng ${payment.transactionId}`,
            returnUrl: callbackUrl || config.returnUrl,
          };
          paymentUrl = await vnpayHelper.createPaymentUrl(data, config);
          break;
        default:
          throw new Error("Payment gateway not supported");
      }
      await tnx.ordership.updateMany({
        where: { orderId: orderInfo.id },
        data: {
          paymentTransactionId: payment.transactionId,
        },
      });
      return paymentUrl;
    });
  },

  handleOnlinePaymentMultiStore: async (
    orderInfo: any,
    paymentGateway: PaymentGateway = PaymentGateway.VNPAY,
    options: { callbackUrl?: string; ipAddr?: string } = {},
  ) => {
    return paymentHelper.handleOnlinePayment(
      orderInfo,
      paymentGateway,
      options,
    );
  },

  createPaymentTransaction: async (
    tnx: any,
    orderInfo: any,
    uniqueTransactionId: string,
    timeoutMinutes: number,
    paymentGateway: PaymentGateway,
  ) => {
    const alreadyForPayTrans = await tnx.paymentTransaction.findFirst({
      where: {
        customer: orderInfo.customerId,
        orderId: orderInfo.id,
        partner: paymentGateway,
      },
    });
    if (alreadyForPayTrans) return alreadyForPayTrans;
    return tnx.paymentTransaction.create({
      data: {
        totalAmmount: orderInfo.moneyPaid ?? orderInfo.totalMoney,
        customer: orderInfo.customerId,
        orderId: orderInfo.id,
        paymentMethod: "pay",
        partner: paymentGateway,
        status: "processing",
        transactionId: `${uniqueTransactionId}`,
        timeout:
          timeoutMinutes > 0
            ? moment().add(timeoutMinutes, "minutes").valueOf()
            : moment().add(1, "hours").valueOf(),
        retry: 0,
      },
    });
  },
};
export default paymentHelper;
