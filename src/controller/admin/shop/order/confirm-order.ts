import actionLogMidlleware from "@root/src/middleware/actionLog";
import userMidlleware from "@root/src/middleware/user";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import pageMiddleware from "@src/middleware/page";
import { RoleSpecial, OrderPaymentStatusEnum } from "@prisma/client";
import ono from "@jsdevtools/ono";
import { prismaClient, Prisma } from "@root/src/utils/prisma";
import { paymentTransactionService } from "@root/src/services/paymentTransaction.service";
import ShipManager from "../../../../utils/shipManager";
import { MessageConfirmOrder } from "@root/src/types/order.type";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/confirm-order`,
    preHandler: [userMidlleware as any, pageMiddleware, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        orderShipId: z.number().describe("id của đơn hàng"),
        status: z.enum(["confirm", "cancel"]).describe("Trạng thái xác nhận"),
        cancelReason: z.string().describe("Lý do hủy đơn hàng").optional(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        // @ts-ignore
        const storeId = req.storeId;
        //@ts-ignore
        const roleSpecial = req.roleSpecial;
        if (roleSpecial !== RoleSpecial.SHOP) {
          throw ono({
            code: "e_permission_denied",
            message: "Bạn không có quyền thực hiện hành động này",
          });
        }
        const { orderShipId, status, cancelReason } = req.body;
        const orderShip = await prismaClient.ordership.findUnique({
          where: { id: orderShipId, storeId },
        });
        if (!orderShip) {
          throw ono({
            code: "e_order_ship_not_found",
            message: "Đơn hàng không tồn tại",
          });
        }
        if (orderShip.status !== OrderPaymentStatusEnum.wait_for_confirmation) {
          throw ono({
            code: "e_order_ship_status_invalid",
            message: "Trạng thái đơn hàng không hợp lệ",
          });
        }
        if (status === "cancel") {
          if (orderShip.paymentMethodShip === "online") {
            const paymentTransaction =
              await prismaClient.paymentTransaction.findFirst({
                where: {
                  orderId: orderShip.orderId,
                  status: "success",
                },
              });
            if (!paymentTransaction) {
              throw ono({
                code: "e_payment_transaction_not_found",
                message: "Không tìm thấy giao dịch thanh toán",
              });
            }
            await paymentTransactionService.refundSuccessfulPayment(
              paymentTransaction,
              cancelReason || "Hoàn tiền do cửa hàng từ chối đơn"
            );
          }
          await prismaClient.$transaction(async (tx) => {
            await tx.ordership.update({
              where: { id: orderShipId },
              data: {
                status: OrderPaymentStatusEnum.canceled,
                cancelReason,
              },
            });
            await tx.order.update({
              where: { id: orderShip.orderId },
              data: {
                paymentStatus: OrderPaymentStatusEnum.canceled,
                cancelReason,
              },
            });
          });
          return res.send({
            code: 0,
            message: "Hủy đơn hàng thành công",
          });
        }
        if (status === "confirm") {
          // Call ordership
          const shipManager = ShipManager.getInstance();
          const productName = `${(orderShip.orderItemInfos as any[])
            ?.map(
              (item, index) =>
                `${index + 1}. ${item.name} - ${item.attributeValues} SL: ${item.quantity} \n`
            )
            .join(", ")}`;
          const result = await shipManager.createOrder({
            moneyCollection:
              orderShip.paymentMethodShip === "cod"
                ? (orderShip.totalMoney ?? 0)
                : 0,
            orderId: orderShip.orderId.toString(),
            senderAddress: orderShip.deliveryAddress || "",
            paymentMethod:
              orderShip.paymentMethodShip === "cod" ? "COD" : "ONLINE",
            note: orderShip.note || "",
            productPrice: orderShip.moneyCash ?? 0,
            productWeight: orderShip.totalWeight ?? 0,
            receiverAddress: orderShip.receiveAddress || "",
            receiverFullName: orderShip.receiveName || "",
            receiverPhone: orderShip.receivePhone || "",
            senderPhone: orderShip.deliveryPhone || "",
            senderFullName: orderShip.deliveryName || "",
            productQuantity: (orderShip.orderItemInfos as any[])?.reduce(
              (acc, item) => acc + item.quantity,
              0
            ),
            serviceId: orderShip.shipServiceCode || "",
            serviceAdd: "",
            items: (orderShip.orderItemInfos as any[])?.map((item) => {
              return {
                productName: item.name,
                productQuantity: item.quantity,
                productPrice: item.itemPrice,
                productWeight: item.totalWeight,
              };
            }),
            productName,
            productDescription: "",
          });
          if (!result || !result.id) {
            throw ono({
              code: "e_ship_order_failed",
              message: "Tạo đơn hàng thất bại",
            });
          }
          const statusOrder = OrderPaymentStatusEnum.wait_for_pickup;
          const shipMessages: any = orderShip.shipMsg;
          shipMessages.push({
            time: new Date().getTime(),
            message: "Nguời gửi đang chuẩn bị hàng",
          });
          const dataUpdateOrderShip: Prisma.ordershipUpdateInput = {
            shipOrderCodeId: result.refId,
            status: statusOrder,
            shipMsg: shipMessages,
          };
          const dataUpdateOrder: Prisma.orderUpdateInput = {
            paymentStatus: statusOrder,
          };
          await prismaClient.$transaction(async (tx) => {
            await tx.ordership.update({
              where: { id: orderShipId },
              data: dataUpdateOrderShip,
            });
            await tx.order.update({
              where: { id: orderShip.orderId },
              data: dataUpdateOrder,
            });
          });
          return res.send({
            code: 0,
            message: "Xác nhận đơn hàng thành công",
          });
        }
      } catch (err: any) {
        if (
          err instanceof ono &&
          MessageConfirmOrder[
            (err as any).code as keyof typeof MessageConfirmOrder
          ]
        ) {
          return res.send({
            code: 1,
            message:
              MessageConfirmOrder[
                (err as any).code as keyof typeof MessageConfirmOrder
              ],
            err: err,
          });
        }
        console.log(err);
        return res.send({
          code: 1,
          message: "Có lỗi xảy ra",
          err: err,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
