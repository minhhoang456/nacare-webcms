import ono from "@jsdevtools/ono";
import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import paymentTransactionService from "@root/src/services/paymentTransaction.service";
import voucherService from "@root/src/services/voucher.service";
import {
  clearConsumptionPointCache,
  releaseReservedConsumptionPoint,
} from "@root/src/services/consumptionPoint.service";
import { releaseReservedCommissionWallet } from "@root/src/services/commissionWalletOrderPayment.service";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/cancel-order`,
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Product-Order"],
      body: z.object({
        orderShipId: z.number().describe("Order Ship ID"),
        cancelReason: z.string().optional(),
      }),
      response: {},
    },
    handler: async (req, res) => {
      const { customerId } = req as any;
      const { orderShipId, cancelReason } = req.body;

      try {
        const orderShipInfo = await prismaClient.ordership.findFirst({
          where: {
            id: orderShipId,
            customerId,
          },
          select: {
            id: true,
            status: true,
            orderId: true,
            mexchangeOrderId: true,
            mpoint: true,
            totalMoney: true,
            paymentTransactionId: true,
            discount: true,
            discountVoucherId: true,
            discountCode: true,
            orderUniqueId: true,
          },
        });

        if (!orderShipInfo) throw ono("e_can_not_found_order");
        if (orderShipInfo.status === "canceled")
          throw ono("e_can_not_cancel_order_canceled");
        if (
          orderShipInfo.status &&
          !statusCanCancelOrderForOrderShip.includes(orderShipInfo.status)
        )
          throw ono("e_can_not_cancel_order_shipping");
        if (
          orderShipInfo.totalMoney &&
          orderShipInfo.totalMoney > 0 &&
          orderShipInfo.paymentTransactionId
        ) {
          const paymentTransaction =
            await prismaClient.paymentTransaction.findFirst({
              where: {
                customer: customerId,
                orderId: orderShipInfo.orderId,
                transactionId: orderShipInfo.paymentTransactionId,
                paymentMethod: "pay",
              },
            });
          if (paymentTransaction) {
            await paymentTransactionService.refundSuccessfulPayment(
              paymentTransaction,
              cancelReason || "Hoàn tiền do khách hàng hủy đơn",
            );
          }
        }
        const changedPointCustomerId = await prismaClient.$transaction(
          async (tx) => {
            await tx.orderitem.updateMany({
              where: { orderShipId: orderShipInfo.id },
              data: { status: "canceled", cancelReason },
            });
            await tx.ordership.update({
              where: { id: orderShipInfo.id },
              data: { status: "canceled", cancelReason },
            });
            await tx.order.update({
              where: { id: orderShipInfo.orderId },
              data: { paymentStatus: "canceled" },
            });
            await releaseReservedCommissionWallet(
              tx,
              Number(orderShipInfo.orderId),
            );
            return releaseReservedConsumptionPoint(
              tx,
              Number(orderShipInfo.orderId),
            );
          },
        );
        if (changedPointCustomerId) {
          await clearConsumptionPointCache([changedPointCustomerId]);
        }
        if (orderShipInfo.discountCode) {
          await voucherService.unlockCode(orderShipInfo.discountCode);
          await voucherService.rollbackVoucherUsage(
            orderShipInfo.discountCode,
            orderShipInfo.orderUniqueId || "",
          );
        }
        return res.send({
          code: 0,
          message: "Hủy đơn hàng thành công",
        });
      } catch (error: any) {
        console.log("Cancel-order-error : ", error);
        return res.send({
          code: 1,
          message: error.message
            ? error_cancel_order[error.message] || error.message
            : "Hệ thống bận, vui lòng thử lại",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
const error_cancel_order: Record<string, string> = {
  e_can_not_found_order: "Không tìm thấy đơn hàng",
  e_can_not_cancel_order: "Đơn hàng không thể hủy",
  failed_precondition: "Đơn hàng đã được hủy",
  not_found: "Không tìm thấy thông tin vận chuyển",
  e_can_not_cancel_order_shipping: "Không thể hủy đơn hàng đang vận chuyển",
  e_order_ship_error: "Thông tin đơn hàng không đúng",
  e_can_not_cancel_order_canceled:
    "Không thể thực hiện thao tác hủy. Lí do đơn hàng đã được hủy",
};

const statusCanCancelOrderForOrderShip = [
  "wait_for_confirmation",
  "comfirmed",
  "pending",
  "processing",
];
