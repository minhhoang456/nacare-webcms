import { OrderPaymentStatusEnum } from "@prisma/client";
import orderProductHelper from "@root/src/helpers/orderProduct.helper";
import paymentHelper from "@root/src/helpers/payment.helper";
import customerMiddleware from "@root/src/middleware/customer";
import flashSaleProductService from "@root/src/services/flashSaleProduct.service";
import itemService from "@root/src/services/item.service";
import voucherService from "@root/src/services/voucher.service";
import { PaymentGateway } from "@root/src/types/enums";
import { Prisma, prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  clearConsumptionPointCache,
  reserveConsumptionPoint,
  consumeReservedConsumptionPoint,
  vietnamDate,
} from "@root/src/services/consumptionPoint.service";
import paymentTransactionService from "@root/src/services/paymentTransaction.service";
import {
  reserveCommissionWalletForOrder,
  consumeReservedCommissionWallet,
} from "@root/src/services/commissionWalletOrderPayment.service";
import invoiceUtils from "@root/src/utils/invoice";
import redis from "@root/src/utils/redis";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/create-order`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["order"],
      description: "Tạo đơn hàng",
      summary: "Tạo đơn hàng",
      body: z.object({
        productsInfo: z.array(
          z.object({
            productId: z.number().describe("ID sản phẩm"),
            quantity: z.number().describe("Số lượng sản phẩm"),
          }),
        ),
        serviceShipId: z.string().optional().describe("ID dịch vụ vận chuyển"),
        provinceId: z
          .number()
          .optional()
          .describe("ID Tỉnh/Thành phố nhận hàng"),
        wardId: z.number().optional().describe("ID Phường/Xã nhận hàng"),
        address: z.string().optional().describe("Địa chỉ chi tiết nhận hàng"),
        fullAddress: z.string().describe("Full địa chỉ nhận hàng").optional(),
        note: z.string().optional().describe("Ghi chú đơn hàng"),
        paymentMethod: z
          .literal("online")
          .default("online")
          .describe("Phương thức thanh toán trực tuyến"),
        paymentGateway: z
          .nativeEnum(PaymentGateway)
          .default(PaymentGateway.VNPAY)
          .describe("Cổng thanh toán"),
        receivePhone: z.string().describe("Số điện thoại nhận hàng").optional(),
        receiveName: z.string().describe("Tên người nhận hàng").optional(),
        receiveEmail: z.string().describe("Email người nhận hàng").optional(),
        invoiceInfo: z
          .object({
            type: z.enum(["customer", "company"]).describe("Loại hóa đơn"),
            name: z.string().describe("Tên người nhận hóa đơn"),
            address: z
              .string()
              .describe("Địa chỉ người nhận hóa đơn")
              .optional(),
            phone: z
              .string()
              .describe("Số điện thoại người nhận hóa đơn")
              .optional(),
            email: z.string().describe("Email người nhận hóa đơn").optional(),
            taxCode: z
              .string()
              .describe("Mã số thuế người nhận hóa đơn")
              .optional(),
          })
          .optional()
          .describe("Thông tin hóa đơn điện tử"),
        voucherCode: z.string().optional().describe("Mã voucher"),
        requestId: z.string().optional().describe("ID yêu cầu"),
        consumptionPointUsed: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .describe("Số điểm tiêu dùng áp dụng cho đơn"),
        commissionWalletUsed: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .describe("Số tiền ví hoa hồng áp dụng cho đơn"),
      }),
      response: {},
    },
    handler: async (req, res) => {
      const orderUniqueId = uuidv4();
      const {
        productsInfo,
        fullAddress,
        address,
        provinceId,
        wardId,
        note,
        paymentMethod,
        receivePhone,
        receiveName,
        receiveEmail,
        voucherCode,
        requestId,
        paymentGateway,
        consumptionPointUsed,
        commissionWalletUsed,
      } = req.body;
      try {
        //@ts-ignore
        const customerId = req.customerId;

        let finalAddress = fullAddress || address || "";
        const resolvedProvinceId = provinceId ? Number(provinceId) : null;
        const resolvedWardId = wardId ? Number(wardId) : null;

        if (resolvedProvinceId && resolvedWardId && !fullAddress) {
          const [wardName, provinceName] = await Promise.all([
            redis.get(`ward:${resolvedWardId}`),
            redis.get(`province:${resolvedProvinceId}`),
          ]);
          finalAddress = [address, wardName, provinceName]
            .filter(Boolean)
            .join(", ");
        }
        const fullProductInfo =
          await orderProductHelper.processProductInfo(productsInfo);
        // Check flashsale
        const flashSaleProducts: any =
          await flashSaleProductService.getFlashSaleProductInfoByProductIds(
            productsInfo.map((e) => e.productId),
          );
        let itemsHoldFlashSaleInfo: any[];
        let flashSaleIdsNotEnoughQuantity: number[] = [];
        if (flashSaleProducts.length > 0) {
          itemsHoldFlashSaleInfo = flashSaleProducts.map((e: any) => {
            const product = productsInfo.find(
              (productInfo) => productInfo.productId === e.productDetailId,
            );
            return {
              itemId: e.itemId,
              quantity: product?.quantity,
            };
          });
          const itemIdsflashSaleIdsNotEnoughQuantity: number[] =
            await itemService.holdingItemFlashSale({
              itemsHoldInfo: itemsHoldFlashSaleInfo,
              isCalculatPrice: false,
            });
          if (itemIdsflashSaleIdsNotEnoughQuantity.length > 0) {
            flashSaleIdsNotEnoughQuantity = flashSaleProducts
              .filter((e: any) => {
                if (
                  itemIdsflashSaleIdsNotEnoughQuantity.some(
                    (itemId) => itemId === e.itemId,
                  )
                ) {
                  return true;
                }
                return false;
              })
              .map((e: any) => e.id);
          }
        }
        const { orderInfo, orderItemInfos, errorMessageVoucherCode } =
          await orderProductHelper.prepareOrderWithoutShipping({
            productsInfo: fullProductInfo as any,
            flashSaleIdsNotEnoughQuantity,
            voucherCode,
            customerId,
            consumptionPointUsed,
            commissionWalletUsed,
          });
        if (voucherCode) {
          if (errorMessageVoucherCode) {
            return res.send({
              code: 1,
              message: errorMessageVoucherCode,
            });
          } else {
            const isLock = await voucherService.lockCode(
              voucherCode,
              orderUniqueId,
            );
            if (!isLock) {
              return res.send({
                code: 1,
                message:
                  "Không tìm thấy mã voucher hoặc mã voucher đã được sử dụng",
              });
            }
            const isUseVoucher = await voucherService.useCodeInOrder(
              voucherCode,
              customerId,
              orderUniqueId,
            );
            if (!isUseVoucher) {
              return res.send({
                code: 1,
                message: "Mã voucher không hợp lệ",
              });
            }
          }
        }
        const itemsHoldInfo = fullProductInfo.map((e: any) => {
          return {
            itemId: e.itemId,
            quantity: e.quantity,
          };
        });
        await itemService.holdingItem(itemsHoldInfo);
        let order: any;
        try {
          const result = await prismaClient.$transaction(async (tx) => {
            // Thanh toán hết bằng các ví hoàn tất ngay trong transaction.
            // Đơn còn tiền chờ IPN từ cổng thanh toán.
            const paidWithWallet =
              orderInfo.cashToPay === 0 &&
              (orderInfo.consumptionPointUsed > 0 ||
                orderInfo.commissionWalletUsed > 0);
            const completedAt = paidWithWallet ? Date.now() : null;
            const statusOrder = paidWithWallet
              ? OrderPaymentStatusEnum.completed
              : OrderPaymentStatusEnum.processing;
            const imageProduct =
              fullProductInfo?.length > 0
                ? ((fullProductInfo[0].images as string[])[0] as string)
                : null;
            const order = await tx.order.create({
              data: {
                discount: orderInfo.discountCodeMoney,
                totalMoney: orderInfo.totalMoney,
                pointPaid: orderInfo.pointPaid,
                moneyPaid: orderInfo.cashToPay,
                consumptionPointUsed: BigInt(orderInfo.consumptionPointUsed),
                commissionWalletUsed: BigInt(orderInfo.commissionWalletUsed),
                customerId: customerId,
                provinceId: resolvedProvinceId,
                wardId: resolvedWardId,
                districtId: null,
                receiveName: receiveName,
                receivePhone: receivePhone,
                receiveEmail: receiveEmail,
                address: finalAddress,
                itemCount: fullProductInfo.length,
                image: imageProduct,
                shipMoney: orderInfo.shipMoney,
                methodPayment: paymentMethod,
                typeItem: "product",
                orderPlace: orderInfo.orderPlace,
                totalToppingsPrice: 0,
                totalAccumulatePoints: 0,
                discountCode: voucherCode || "",
                discountVoucherId: 0,
                note: note || "",
                paymentStatus: statusOrder,
                timeCompletedOrder: completedAt,
                orderUniqueId: orderUniqueId,
                requestId: requestId || "",
              },
            });
            await reserveConsumptionPoint(
              tx,
              customerId,
              order.id,
              orderInfo.consumptionPointUsed,
            );
            await reserveCommissionWalletForOrder(
              tx,
              customerId,
              order.id,
              orderInfo.commissionWalletUsed,
            );
            if (completedAt !== null) {
              await consumeReservedConsumptionPoint(tx, order.id, completedAt);
              await consumeReservedCommissionWallet(tx, order.id, completedAt);
              const calculationDate = vietnamDate(completedAt);
              // Lưu mốc xử lý bù hoa hồng nếu tiến trình dừng sau khi commit.
              await tx.commissionRealtimeRun.upsert({
                where: { calculationDate },
                create: {
                  calculationDate,
                  status: "pending",
                  lastOrderCompletedAt: BigInt(completedAt),
                  createdAt: BigInt(completedAt),
                  updatedAt: BigInt(completedAt),
                },
                update: { lastOrderCompletedAt: BigInt(completedAt) },
              });
            }
            const orderShip = await tx.ordership.create({
              data: {
                storeId: fullProductInfo[0].storeId,
                storeInfo: orderInfo.storeInfo,
                orderId: order.id,
                customerId,
                receiveName: receiveName,
                receivePhone: receivePhone,
                receiveEmail: receiveEmail,
                receiveAddress: fullAddress,
                totalWeight: orderInfo.totalWeight,
                shipMoney: 0,
                mpoint: 0,
                consumptionPointUsed: BigInt(orderInfo.consumptionPointUsed),
                commissionWalletUsed: BigInt(orderInfo.commissionWalletUsed),
                discountInfo: {},
                discountVoucherId: 0,
                discountCode: voucherCode || "",
                discount: orderInfo.discountCodeMoney,
                paymentMethodShip: paymentMethod,
                moneyCash: orderInfo.cashToPay,
                totalMoney: orderInfo.totalMoney,
                typeItem: "product",
                useStoreServiceShip: false,
                image: imageProduct,
                orderPlace: "none",
                typeShip: "none",
                note: note || "",
                status: statusOrder,
                timeCompletedOrder: completedAt,
                totalToppingsPrice: 0,
                totalAccumulatePoints: 0,
                shipMsg: [
                  {
                    time: new Date().getTime(),
                    message: "Đơn hàng đã được tạo",
                  },
                ],
                orderUniqueId: orderUniqueId,
              },
            });
            const orerItemsDataCreate: Prisma.orderitemCreateManyInput[] = [];
            orderItemInfos.forEach((itemInfo) => {
              orerItemsDataCreate.push({
                createdAt: new Date().getTime(),
                updatedAt: new Date().getTime(),
                amountAccumulatePoints: 0,
                attributeValues: itemInfo.attributeValues,
                orderId: order.id,
                customerId: customerId,
                type: "product",
                typeId: itemInfo.typeId,
                itemId: itemInfo.itemId,
                mexchangeId: itemInfo.mexchangeId,
                images: itemInfo.images as any,
                name: itemInfo.name,
                quantity: itemInfo.quantity,
                totalPrice: itemInfo.totalPrice,
                itemPrice: itemInfo.itemPrice,
                point: itemInfo.point || 0,
                cash: itemInfo.cash || 0,
                status: paidWithWallet ? "completed" : "pending",
                cancelReason: "",
                productTypeId: itemInfo.productTypeId,
                typeItem: "product",
                payment: itemInfo.payment,
                discount: itemInfo.discount || 0,
                storeId: itemInfo.storeId,
                orderShipId: orderShip.id,
                flashSaleProductId: itemInfo.flashSaleProductId || 0,
                totalWeight: itemInfo.totalWeight,
              });
            });
            await tx.orderitem.createMany({
              data: orerItemsDataCreate,
            });
            const orderItems = await tx.orderitem.findMany({
              where: { orderId: order.id },
            });
            await tx.ordership.update({
              where: { id: orderShip.id },
              data: {
                orderItemInfos: orderItems,
              },
            });
            // const dataInvoice: Prisma.InvoiceOrderCreateInput = {
            //   email: invoiceInfo?.email || "",
            //   name: invoiceInfo?.name || "Khách không cung cấp tên",
            //   orderId: order.id,
            //   address: invoiceInfo?.address || "KH không cung cấp",
            //   taxCode: invoiceInfo?.taxCode || "",
            //   type: invoiceInfo?.type || InvoiceType.customer,
            //   status: InvoiceStatus.pending,
            //   vatRate: Conf.get("PERCENT_TAX_NUMBER", 10),
            // };
            // await tx.invoiceOrder.create({
            //   data: dataInvoice,
            // });
            return {
              order,
            };
          });
          if (result) {
            order = result.order;
          }
        } catch (err) {
          // Khoản giữ ví có thể bị từ chối nếu một yêu cầu rút/mua khác vừa
          // dùng số dư. Khi tạo đơn rollback, trả cả số lượng hàng đã giữ.
          try {
            await itemService.rollbackHolding(itemsHoldInfo);
          } catch (rollbackError) {
            req.log.error(
              rollbackError,
              "Không thể nhả hàng sau khi tạo đơn thất bại",
            );
          }
          if (voucherCode) {
            await voucherService.unlockCode(voucherCode);
            await voucherService.rollbackVoucherUsage(
              voucherCode,
              orderUniqueId,
            );
          }
          throw err;
        }

        if (orderInfo.consumptionPointUsed > 0) {
          await clearConsumptionPointCache([customerId]);
        }

        if (order.paymentStatus === OrderPaymentStatusEnum.completed) {
          // Dùng chung bước hoàn tất giữ hàng và kích hoạt hoa hồng với IPN.
          // Đơn và giao dịch trừ điểm đã commit; lỗi tác vụ sau đó không đổi
          // kết quả thanh toán của khách thành thất bại.
          try {
            await paymentTransactionService.processSuccessfulTransaction({
              orderId: order.id,
            });
          } catch (error) {
            req.log.error(
              error,
              "Không thể hoàn tất tác vụ sau thanh toán bằng ví",
            );
          }
          void invoiceUtils.createInvoice(order.id).catch((error) => {
            req.log.error(
              error,
              "Không thể tạo hóa đơn cho đơn thanh toán bằng ví",
            );
          });
          return res.send({
            code: 0,
            message: "Đơn hàng đã hoàn tất bằng ví",
            data: {
              orderId: order.id,
              paymentStatus: "completed",
              paymentUrl: null,
              orderInfo,
            },
          });
        }

        if (requestId) {
          return res.send({
            code: 0,
            message: "Thành công",
            data: {
              orderInfo,
            },
          });
        }
        let paymentUrl: string;
        try {
          paymentUrl = await paymentHelper.handleOnlinePayment(
            order,
            paymentGateway,
            { ipAddr: req.ip },
          );
        } catch (error) {
          await orderProductHelper.updateStatusOrderProduct({
            orderId: order.id,
            status: OrderPaymentStatusEnum.canceled,
            reasonCancel: "Không thể khởi tạo giao dịch thanh toán",
          });
          throw error;
        }
        return res.send({
          code: 0,
          message: "Tiến hành thanh toán",
          data: { paymentUrl },
        });
      } catch (err: any) {
        console.log("🚀 ~ err:", err);
        const pointErrorMessages: Record<string, string> = {
          e_consumption_point_invalid: "Số điểm tiêu dùng không hợp lệ",
          e_consumption_point_not_enough: "Số dư điểm tiêu dùng không đủ",
          e_consumption_point_exceeds_order:
            "Số điểm sử dụng vượt quá giá trị đơn hàng",
          e_consumption_point_minimum_payment:
            "Số tiền còn thanh toán online phải từ 10.000đ, hoặc dùng ví thanh toán toàn bộ đơn hàng",
          e_commission_wallet_invalid: "Số tiền ví hoa hồng không hợp lệ",
          e_commission_wallet_exceeds_order:
            "Tổng tiền dùng từ các ví vượt quá giá trị đơn hàng",
          e_commission_wallet_not_enough: "Số dư ví hoa hồng không đủ",
        };
        return res.status(200).send({
          code: 1,
          message:
            pointErrorMessages[err?.message] || "Có lỗi xảy ra khi đặt hàng",
          error: err,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
