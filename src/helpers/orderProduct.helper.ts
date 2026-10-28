import ono from "@jsdevtools/ono";
import { ParamsCalculatePriceOrder } from "../types/order.type";
import {
  orderitem,
  OrderItemStatus,
  OrderPaymentStatusEnum,
} from "@prisma/client";
import flashSaleProductService from "../services/flashSaleProduct.service";
import { storeService } from "../services/store.service";
import { prismaClient, Prisma } from "@root/src/utils/prisma";
import { product } from "@prisma/client";
import { geocodingService } from "../services/geocoding.service";
import Conf from "@src/services/conf";
import { v4 as uuidv4 } from "uuid";
import redis from "../utils/redis";
import invoiceUtils from "../utils/invoice";
import voucherService from "../services/voucher.service";
import OrderReturnsService from "../services/OrderReturns.service";
import {
  clearConsumptionPointCache,
  consumeReservedConsumptionPoint,
  getConsumptionPointBalance,
  releaseReservedConsumptionPoint,
} from "../services/consumptionPoint.service";
import {
  getCommissionWalletAvailable,
  consumeReservedCommissionWallet,
  releaseReservedCommissionWallet,
} from "../services/commissionWalletOrderPayment.service";

interface GroupedProductAttributes {
  productId: number;
  attributeValues: string;
}
const orderProductHelper = {
  calculatePriceOrder: async (params: ParamsCalculatePriceOrder) => {
    return orderProductHelper.prepareOrderWithoutShipping(params);
  },

  // Luồng mới không sử dụng vận chuyển. Backend vẫn phải tự tính lại tiền
  // sản phẩm, flash sale và voucher để không tin số tiền do client gửi lên.
  prepareOrderWithoutShipping: async (
    params: Omit<
      ParamsCalculatePriceOrder,
      "serviceShipId" | "fullAddress" | "depotInfo"
    >,
  ) => {
    const {
      productsInfo,
      flashSaleIdsNotEnoughQuantity,
      voucherCode,
      customerId,
      consumptionPointUsed = 0,
      commissionWalletUsed = 0,
    } = params;
    try {
      const storeId = productsInfo[0].storeId;
      const storeInfo = await storeService.getStoreInfoById(storeId);
      const orderItemInfos: Partial<orderitem>[] = [];
      let errorMessageVoucherCode = null;
      const orderInfo: any = {
        totalMoney: 0,
        totalWeight: 0,
        totalPriceProducts: 0,
        pointPaid: 0,
        discountCodeMoney: 0,
        shipMoney: 0,
        orderPlace: "none",
        storeInfo,
      };
      const productAttributes =
        await orderProductHelper.findAttributeValuesFromProductIds(
          productsInfo.map((e) => e.productId),
        );
      let flashSaleProductInfos =
        await flashSaleProductService.getFlashSaleProductInfoByProductIds(
          productsInfo.map((e) => e.productId),
        );
      if (flashSaleIdsNotEnoughQuantity.length > 0) {
        flashSaleProductInfos = flashSaleProductInfos.filter((e: any) => {
          if (!flashSaleIdsNotEnoughQuantity.some((id) => id === e.id)) {
            return true;
          }
          return false;
        });
      }
      productsInfo.forEach((productInfo) => {
        const flashSaleProductInfo = flashSaleProductInfos.find(
          (e) => e.productId === productInfo.productId,
        );
        let totalPrice = 0;
        if (flashSaleProductInfo) {
          productInfo.flashSaleProductId = flashSaleProductInfo.id;
          productInfo.salePrice = flashSaleProductInfo.salePrice;
        }
        if (productInfo.salePrice) {
          orderInfo.totalMoney += productInfo.salePrice * productInfo.quantity;
          orderInfo.totalPriceProducts +=
            productInfo.salePrice * productInfo.quantity;
          totalPrice = productInfo.salePrice * productInfo.quantity;
        } else {
          orderInfo.totalMoney +=
            productInfo.paymentCash * productInfo.quantity;
          orderInfo.totalPriceProducts +=
            productInfo.paymentCash * productInfo.quantity;
          totalPrice = productInfo.paymentCash * productInfo.quantity;
        }
        orderInfo.totalWeight += productInfo.weight * productInfo.quantity;
        const attributeValues = productAttributes.find(
          (e) => e.productId === productInfo.productId,
        )?.attributeValues;
        const orderItemInfo: Partial<orderitem> = {
          typeId: productInfo.productId,
          quantity: productInfo.quantity,
          images: productInfo.images,
          storeId: productInfo.storeId,
          name: productInfo.name,
          totalPrice: totalPrice,
          itemPrice: productInfo.paymentCash,
          salePrice: productInfo.salePrice ? productInfo.salePrice : 0,
          attributeValues: attributeValues || "",
          discount: 0,
          flashSaleProductId: productInfo.flashSaleProductId || 0,
          totalWeight: productInfo.weight * productInfo.quantity,
        };
        orderItemInfos.push(orderItemInfo);
      });
      orderInfo.storeId = storeId;
      if (voucherCode) {
        const resultCheckVoucher = await voucherService.checkValidCode(
          customerId,
          voucherCode,
          orderInfo.totalPriceProducts,
        );
        if (resultCheckVoucher.isValid) {
          orderInfo.discountCodeMoney = resultCheckVoucher.discountAmount || 0;
          orderInfo.totalMoney -= orderInfo.discountCodeMoney;
          orderItemInfos.forEach((e) => {
            e.discount = Math.floor(
              (orderInfo.discountCodeMoney * (e.totalPrice || 0)) /
                orderInfo.totalPriceProducts,
            );
          });
        } else {
          errorMessageVoucherCode = resultCheckVoucher.error;
          orderInfo.discountCodeMoney = 0;
        }
      }
      if (
        !Number.isSafeInteger(consumptionPointUsed) ||
        consumptionPointUsed < 0
      ) {
        throw ono("e_consumption_point_invalid");
      }
      if (consumptionPointUsed > orderInfo.totalMoney) {
        throw ono("e_consumption_point_exceeds_order");
      }
      if (
        !Number.isSafeInteger(commissionWalletUsed) ||
        commissionWalletUsed < 0
      ) {
        throw ono("e_commission_wallet_invalid");
      }
      if (commissionWalletUsed > orderInfo.totalMoney - consumptionPointUsed) {
        throw ono("e_commission_wallet_exceeds_order");
      }
      const cashToPay =
        orderInfo.totalMoney - consumptionPointUsed - commissionWalletUsed;
      if (
        cashToPay > 0 &&
        cashToPay < 10000 &&
        (consumptionPointUsed > 0 || commissionWalletUsed > 0)
      ) {
        throw ono("e_consumption_point_minimum_payment");
      }
      const pointBalance = await getConsumptionPointBalance(customerId);
      if (consumptionPointUsed > pointBalance.available) {
        throw ono("e_consumption_point_not_enough");
      }
      const commissionWalletAvailable =
        await getCommissionWalletAvailable(customerId);
      if (commissionWalletUsed > commissionWalletAvailable) {
        throw ono("e_commission_wallet_not_enough");
      }
      orderInfo.consumptionPointUsed = consumptionPointUsed;
      orderInfo.commissionWalletUsed = commissionWalletUsed;
      orderInfo.cashToPay = cashToPay;
      orderInfo.consumptionPointAvailable = pointBalance.available;
      orderInfo.commissionWalletAvailable = commissionWalletAvailable;
      return {
        orderInfo,
        orderItemInfos,
        shippingInfo: null,
        listShipService: [],
        errorMessageVoucherCode,
      };
    } catch (err: any) {
      if (
        [
          "e_consumption_point_invalid",
          "e_consumption_point_not_enough",
          "e_consumption_point_exceeds_order",
          "e_consumption_point_minimum_payment",
          "e_commission_wallet_invalid",
          "e_commission_wallet_exceeds_order",
          "e_commission_wallet_not_enough",
        ].includes(err?.message)
      ) {
        throw err;
      }
      throw ono({
        code: "ERROR_CALCULATE_PRICE_ORDER",
        message: "Lỗi tính toán giá đơn hàng",
        cause: err,
      });
    }
  },

  async processProductInfo(
    productsInfo: {
      quantity: number;
      productId: number;
    }[],
  ) {
    await orderProductHelper.checkQuantity({ productsInfo });
    const productIds: number[] = [];
    productsInfo.forEach((e: any) => {
      productIds.push(e.productId);
    });
    const productsInfoInDatabase = await prismaClient.product.findMany({
      where: {
        id: {
          in: productIds,
        },
      },
    });
    if (productIds.length !== productsInfoInDatabase.length) {
      throw ono({
        code: "e_can_not_find_detail_info_cart",
        message: "Không tìm thấy thông tin chi tiết sản phẩm",
      });
    }
    const storeIds: any[] = [];
    productsInfoInDatabase.forEach(
      (
        product: product & {
          quantity?: number;
          productId?: number;
        },
      ) => {
        if (!storeIds.find((e) => e === product.storeId)) {
          storeIds.push(product.storeId);
        }
        const productCheck = productsInfo.find(
          (e: any) => e.productId === product.id,
        );
        if (productCheck) {
          product.quantity = productCheck.quantity;
          product.productId = productCheck.productId;
        }
      },
    );
    if (storeIds.length >= 2) {
      throw ono({
        code: "e_can_not_order_item_from",
        message: "Không thể đặt hàng từ nhiều đối tác",
      });
    }
    return productsInfoInDatabase;
  },

  async checkQuantity(payload: {
    productsInfo: { quantity: number; productId: number }[];
  }) {
    const { productsInfo } = payload;
    productsInfo.forEach((e: any) => {
      if (e.quantity <= 0 || !Number.isInteger(e.quantity)) {
        throw ono({
          code: "e_quantity_not_match",
          message: "Số lượng không hợp lệ",
        });
      }
    });
    return true;
  },

  findAttributeValuesFromProductIds: async (_productIds: number[]) => {
    const result = await prismaClient.$queryRaw<GroupedProductAttributes[]>`
      SELECT 
        p.id as "productId",
        STRING_AGG(av.name, ', ') as "attributeValues"
      FROM product p
      INNER JOIN productattributevalue pav ON p.id = pav."productId"
      INNER JOIN attributevalue av ON av.id = pav."attributeValueId"
      WHERE p.id in (${Prisma.join(_productIds)})
      GROUP BY p.id
    `;
    return result;
  },

  updateStatusOrderProduct: async ({
    orderId,
    status,
    reasonCancel,
    shipMessage,
    canCancelOrder,
  }: {
    orderId: number;
    status: OrderPaymentStatusEnum;
    reasonCancel?: string;
    shipMessage?: string;
    canCancelOrder?: boolean;
  }) => {
    const order = await prismaClient.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw ono("e_can_not_find_order");
    const terminalStatuses = [
      OrderPaymentStatusEnum.canceled,
      OrderPaymentStatusEnum.completed,
    ];
    const orderShip = await prismaClient.ordership.findFirst({
      where: { orderId },
    });
    if (!orderShip) throw ono("e_can_not_find_order_ship");
    // IPN có thể được gửi lại nhiều lần. Chỉ bỏ qua khi chính đơn hàng đã ở
    // trạng thái kết thúc; vẫn cho phép chuyển từ processing sang completed.
    if (
      order.paymentStatus &&
      terminalStatuses.some((status) => status === order.paymentStatus)
    )
      return;
    const dataUpdateOrder: Prisma.orderUpdateInput = {
      paymentStatus: status,
      cancelReason: reasonCancel,
      canCancelOrder: canCancelOrder,
    };
    const shipMessages: any[] = (orderShip.shipMsg || []) as any[];
    if (shipMessage) {
      shipMessages.push({
        time: new Date().getTime(),
        message: shipMessage,
      });
    }
    const dataUpdateOrderShip: Prisma.ordershipUpdateInput = {
      status: status,
      cancelReason: reasonCancel,
      shipMsg: shipMessages,
    };
    if (status === OrderPaymentStatusEnum.canceled) {
      //
    }
    let completedAt: number | undefined;
    if (status === OrderPaymentStatusEnum.completed) {
      completedAt = new Date().getTime();
      const timeCompletedOrder = completedAt;
      dataUpdateOrder.timeCompletedOrder = timeCompletedOrder;
      dataUpdateOrderShip.timeCompletedOrder = timeCompletedOrder;
    }
    const orderItemStatus = Object.values(OrderItemStatus).find(
      (itemStatus) => itemStatus === status,
    );
    const changedPointCustomerId = await prismaClient.$transaction(
      async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: dataUpdateOrder,
        });
        let changedCustomerId: number | null = null;
        if (completedAt) {
          changedCustomerId = await consumeReservedConsumptionPoint(
            tx,
            orderId,
            completedAt,
          );
          await consumeReservedCommissionWallet(tx, orderId, completedAt);
        } else if (status === OrderPaymentStatusEnum.canceled) {
          changedCustomerId = await releaseReservedConsumptionPoint(
            tx,
            orderId,
          );
          await releaseReservedCommissionWallet(tx, orderId);
        }
        if (completedAt && order.typeOrder !== "return_order") {
          const calculationDate = new Date(completedAt + 7 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);
          // Durable marker cho Mục 1, 3-7: nếu process chết sau khi commit đơn,
          // cron bù vẫn biết đúng ngày cần tính lại, kể cả đã qua 0h.
          await tx.commissionRealtimeRun.upsert({
            where: { calculationDate },
            create: {
              calculationDate,
              status: "pending",
              lastOrderCompletedAt: BigInt(completedAt),
            },
            update: { lastOrderCompletedAt: BigInt(completedAt) },
          });
        }
        if (orderItemStatus) {
          await tx.orderitem.updateMany({
            where: { orderId },
            data: { status: orderItemStatus },
          });
        }
        const orderItems = await tx.orderitem.findMany({
          where: { orderId },
        });
        await tx.ordership.update({
          where: { id: orderShip.id },
          data: {
            ...dataUpdateOrderShip,
            orderItemInfos: orderItems as any,
          },
        });
        return changedCustomerId;
      },
    );
    if (changedPointCustomerId) {
      await clearConsumptionPointCache([changedPointCustomerId]);
    }
    if (status === OrderPaymentStatusEnum.completed) {
      if (order.typeOrder === "return_order") {
        await OrderReturnsService.completeShippingReturnOrder(orderId);
      } else {
        invoiceUtils
          .createInvoice(orderId)
          .then((res) => {
            console.log(res);
          })
          .catch((err) => {
            console.log(err);
          });
      }
    }
  },

  getFirstLatLongFromAddress: async (address: string) => {
    const addresses = await geocodingService.getLatLongFromAddress(address);
    if (addresses?.data && addresses?.data.length > 0) {
      return {
        latitude: Number(addresses?.data[0].latitude),
        longitude: Number(addresses?.data[0].longitude),
      };
    }
    return null;
  },

  getDepotsNearestByLocation: async ({
    latCustomer,
    longCustomer,
    storeId,
  }: {
    latCustomer: number;
    longCustomer: number;
    storeId: number;
  }) => {
    const radiusNormal = Conf.get("RadiusNormal", 1000);
    const depots = await prismaClient.depot.findMany({
      where: {
        storeId,
      },
    });
    if (depots.length === 0) return null;
    const keyGeo = `geo_store_location_of_orderonline_${uuidv4()}`;
    const locationStores: any = [];
    depots.forEach((depot) => {
      if (depot.gpsLocation) {
        const locationStore = depot.gpsLocation.split(",");
        locationStores.push(locationStore[1], locationStore[0], depot.id);
      }
    });
    const locationCustomer = [String(longCustomer), String(latCustomer)];
    if (locationStores.length === 0) return null;
    await redis.geoadd(keyGeo, ...locationStores);
    const result: any = await redis.geosearch(
      keyGeo,
      "FROMLONLAT",
      locationCustomer[0],
      locationCustomer[1],
      "BYRADIUS",
      Number(radiusNormal),
      "km",
      "ASC",
      "WITHCOORD",
      "WITHDIST",
    );
    if (!result || result.length === 0) return null;
    let depotsNearest: any = [];
    for (let i = 0; i < result.length; i++) {
      const depot: any = depots.find((e: any) => e.id == result[i][0]);
      if (depot) {
        depot.distance = Number(result[i][1]);
        depotsNearest.push(depot);
      }
    }
    return depotsNearest;
  },
};
export default orderProductHelper;
