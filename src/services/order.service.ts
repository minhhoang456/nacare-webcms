import { prismaClient } from "@root/src/utils/prisma";
import {
  $Enums,
  FlashSaleProductDetail,
  OrderMethodPaymentEnum,
  Prisma,
} from "@prisma/client";

import Item from "./item.service";
import ono from "@jsdevtools/ono";
import _ from "lodash";
// import voucherHelper from '../helpers/voucher.helpers';
import messagequeue from "./messagequeue";
import Conf from "@src/services/conf";
import Queue, { QueueOptions } from "bull";
import ConfigSystem from "@src/config/config";
import productService from "./product.service";
import productTypeService from "./productType.service";
import moment from "moment";
// import voucherService from './voucher.service';
import flashSaleProductService from "./flashSaleProduct.service";
import voucherService from "./voucher.service";
import {
  clearConsumptionPointCache,
  releaseReservedConsumptionPoint,
} from "./consumptionPoint.service";
import { releaseReservedCommissionWallet } from "./commissionWalletOrderPayment.service";

interface JobType {
  type: "cancelOrder";
  data: any;
}

interface CreateProductOrderParams {
  cart: any[];
  mpointUse: number;
  customerId: number;
  methodPayment: OrderMethodPaymentEnum;
  discountVoucher?: number;
  discountCode?: string;
  shipInfo: {
    storeInfo: any;
    pathInfos: any[];
    shipServiceId: string | number;
  };
  remarks?: string;
}

const queueOptions: QueueOptions = {
  redis: {
    db: ConfigSystem.REDIS_CONFIG.db,
    password: ConfigSystem.REDIS_CONFIG.password,
    host: ConfigSystem.REDIS_CONFIG.host,
    port: ConfigSystem.REDIS_CONFIG.port,
  },
  prefix: `${process.env.REDIS_PREFIX}bull_queue`,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    timeout: 30000,
    attempts: 5,
    backoff: {
      type: "fixed",
      delay: 3000,
    },
  },
  settings: {
    stalledInterval: 60000, //thời gian chờ 60s
  },
};
const orderQueue = new Queue("order_queue", queueOptions);

orderQueue.process(async (job) => {
  const { type, data }: JobType = job.data;
  switch (type) {
    case "cancelOrder": {
      const orderInfo = await prismaClient.order.findUnique({
        where: {
          id: data,
        },
      });
      if (!orderInfo) {
        return;
      }
      await orderService.updatePaymentInfo(orderInfo.id, "canceled");
      break;
    }
  }
});

export const orderService = {
  addQueueItem: (job: JobType) => {
    orderQueue.add(job);
  },

  getOrderById: async (orderId: number) => {
    const orderInfo = await prismaClient.order.findUnique({
      where: {
        id: orderId,
      },
    });
    return orderInfo;
  },

  getOrderShip: async (orderId: number, shipOrderCodeId: string) => {
    const orderShipInfo = await prismaClient.ordership.findFirst({
      where: {
        orderId,
        shipOrderCodeId,
      },
    });
    return orderShipInfo;
  },

  getListOrdersByCustomer: async (
    customerId: number,
    skip: number,
    limit: number
  ) => {
    const data = await prismaClient.order.findMany({
      where: { customerId },
      skip,
      take: limit,
      orderBy: [{ id: "desc" }],
    });
    return data;
  },

  createProductOrder: async (params: CreateProductOrderParams) => {
    const { cart, mpointUse } = params;

    if (mpointUse && mpointUse < 0) throw ono("e_mpoint_not_match");

    const productIds = cart.map((item) => item.typeId);
    const productInfos =
      await productService.getListProductInfosByIds(productIds);
    // if (productIds.length !== productInfos.length)
    //   throw ono('e_can_not_find_detail_info_cart');

    // Calculate price
    const priceCalculation = await calculateOrderPrice(params, productInfos);

    // Create order, ordership, orderitem
    const { orderItemInfos, orderInfo, orderShipInfos } =
      await createOrderTransaction(params, priceCalculation);

    // Update orderShips with orderItemInfos
    await updateOrderShipsWithItems(orderShipInfos, orderItemInfos);

    //Lock applicable voucher code
    // if (priceCalculation?.isVoucherApply && priceCalculation.discountInfo) {
    //   const { voucherApply, voucherCodeApply } = priceCalculation.discountInfo;
    //   await voucherService.lockCode(voucherCodeApply, orderInfo.id);
    // }

    return { orderItemInfos, orderInfo, orderShipInfos };
  },

  updatePaymentInfo: async (
    orderId: number,
    status: $Enums.OrderPaymentStatusEnum,
    reasonCancel: string = ""
  ) => {
    const order = await prismaClient.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw ono("e_can_not_find_order");
    if (
      order.paymentStatus &&
      ["canceled", "completed"].includes(order.paymentStatus)
    )
      return;

    const changedPointCustomerId = await prismaClient.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: status, cancelReason: reasonCancel },
      });
      if (status !== "canceled") return null;
      await tx.ordership.updateMany({
        where: { orderId, status: { in: ["pending", "processing"] } },
        data: { status: "canceled", cancelReason: reasonCancel },
      });
      const customerId = await releaseReservedConsumptionPoint(tx, orderId);
      await releaseReservedCommissionWallet(tx, orderId);
      return customerId;
    });
    if (changedPointCustomerId) {
      await clearConsumptionPointCache([changedPointCustomerId]);
    }

    const listOrdItems = await prismaClient.orderitem.findMany({
      where: { customerId: order.customerId, orderId },
    });

    const result: any = { order };

    if (status === "canceled") {
      if (order.flashSaleVoucherId) {
        const flashSaleInfo =
          await prismaClient.flashSaleVoucherDetail.findFirst({
            where: { id: order.flashSaleVoucherId },
          });
        if (flashSaleInfo) {
          Item.rollbackHolding([
            {
              itemId: flashSaleInfo.itemId || 0,
              quantity: listOrdItems[0]?.quantity || 0,
            },
          ]);
        }
      }
      if (order.discountCode && order.discount && order.discount > 0) {
        await voucherService.unlockCode(order.discountCode);
        await voucherService.rollbackVoucherUsage(
          order.discountCode,
          order.orderUniqueId || ""
        );
      }
    }

    const orderItemStatus = status === "canceled" ? "canceled" : status;
    messagequeue.addDbItem({
      model: "orderitem",
      action: "update",
      updateCrit: { orderId },
      data: { status: orderItemStatus },
    });

    if (["completed", "refund", "refunded"].includes(status)) {
      result.listOrderItem = listOrdItems;
    } else if (status !== "canceled") {
      result.listOrderItem = listOrdItems.map((item) => {
        messagequeue.addDbItem({
          model: "orderitem",
          action: "update",
          updateCrit: { id: item.id },
          data: { status: "canceled" },
        });
        return item;
      });
    }

    return result;
  },

  cronCancelOrderPaymentOnlineProcessing: async () => {
    try {
      const now = new Date().getTime();
      const timeQuery = now - Conf.get("TIME_PAYMENT_ORDER", 15) * 60 * 1000;
      const orders = await prismaClient.order.findMany({
        where: {
          paymentStatus: "processing",
          createdAt: {
            lte: timeQuery,
          },
          methodPayment: "online",
        },
      });
      orders.forEach((order) => {
        orderService.addQueueItem({
          type: "cancelOrder",
          data: order.id,
        });
      });
    } catch (err) {
      console.log("🚀 ~ cronCancelOrderPending: ~ err:", err);
    }
  },

  reconcileCanceledOrderShips: async () => {
    // Legacy timeout jobs could cancel the parent order while leaving the
    // customer-facing shipment in processing. Repair only those mismatches.
    const ships = await prismaClient.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`
        SELECT s.id FROM ordership s
        JOIN "order" o ON o.id = s."orderId"
        WHERE o."paymentStatus" = 'canceled'
          AND o."methodPayment" = 'online'
          AND s.status IN ('pending', 'processing')
        ORDER BY s.id
        LIMIT 500
      `,
    );
    if (ships.length === 0) return;
    await prismaClient.ordership.updateMany({
      where: {
        id: { in: ships.map((ship) => ship.id) },
        status: { in: ["pending", "processing"] },
      },
      data: { status: "canceled" },
    });
  },

  runCronjob5: async () => {
    await orderService.cronCancelOrderPaymentOnlineProcessing();
    await orderService.reconcileCanceledOrderShips();
  },

  getOrderByExchageId: async (orderExId: string) => {
    const orderInfo = await prismaClient.order.findFirst({
      where: { mexchangeOrderId: orderExId },
    });
    return orderInfo;
  },

  calculatePrice: async (params: {
    cart: any[];
    productInfos: any[];
    mpoint: number;
    discountVoucher?: number;
    discountCode?: string;
    shipInfo: any;
    customerId: number;
  }) => {
    const {
      cart,
      productInfos,
      mpoint,
      discountVoucher,
      discountCode,
      shipInfo,
      customerId,
    } = params;

    let orderPlace = "shipping",
      voucherInfo = null,
      isVoucherApply = false;
    const orderShips: any = {};
    const shippingService: any[] = [];

    //Process product FLS,  product information
    const [flsProductInfos, fullProductTypeInfo, fullAttrs] = await Promise.all(
      [
        flashSaleProductService.getFlashSaleProductInfoByProductIds(
          productInfos.map((p) => p.id)
        ),
        Promise.all(
          productInfos.map((p) =>
            productTypeService.getFullProductTypeInfo(p.productTypeId)
          )
        ),
        productTypeService.getAttrByProductIds(productInfos.map((p) => p.id)),
      ]
    );
    const flashSaleId =
      flsProductInfos.length > 0 ? flsProductInfos[0]?.flashSaleProductId : 0;

    // const _reqCalculate = {
    //   productsInfo: cart.map((item) => {
    //     const productInfo = productInfos.find((p) => p.id === item.typeId);
    //     let addOns = [];
    //     if (item.toppings && item.toppings.length > 0) {
    //       const { productTypeInfo } = fullProductTypeInfo.find(
    //         (p) => p.productTypeInfo.id === productInfo.productTypeId
    //       );
    //       addOns = item.toppings.map((item: any) => {
    //         for (const obj of productTypeInfo.toppings) {
    //           const matchingAddOn = obj.add_ons.add_ons.find(
    //             (addOn: any) => addOn.id === item.id
    //           );
    //           if (matchingAddOn) {
    //             return matchingAddOn;
    //           }
    //         }
    //         return item;
    //       });
    //       addOns = addOns.map((m: any) => ({
    //         quantity: 1,
    //         addOnId: m.id,
    //       }));
    //     }
    //     return {
    //       productId: productInfo?.mexchangeId,
    //       salePrice: flsProductInfos.find((p) => p.productId == item.typeId)
    //         ?.salePrice,
    //       addOns,
    //       quantity: item.quantity,
    //     };
    //   }),
    //   shipInfo,
    //   point: mpoint,
    // };

    //calculate price with request
    const { orderOnlineInfo, orderItemOnlineInfos, shipServices } = {
      orderOnlineInfo: {
        totalMoney: 0,
        totalToppingsPrice: 0,
        shipMoney: 0,
        totalPriceProducts: cart.reduce(
          (sum, item) => sum + (item.totalPrice || 0),
          0
        ),
        pointPaid: mpoint,
        discountCardCode: 0,
        totalWeight: cart.reduce((sum, item) => sum + (item.weight || 0), 0),
      },
      orderItemOnlineInfos: cart.map((item) => ({
        itemPrice: item.itemPrice,
        toppingsPrice: item.toppingsPrice || 0,
        quantity: item.quantity,
        weight: item.weight || 0,
        addOns:
          item.toppings?.map((t: any) => ({
            addOnId: t.id,
          })) || [],
        flashsalePrice: item.salePrice,
      })),
      shipServices: [
        {
          _id: shipInfo.shipServiceId,
          name: "Default Shipping",
          icon_url: "",
          fee: 0,
        },
      ],
    };

    // Update cart items with calculated information
    await Promise.all(
      cart.map(async (item, index) => {
        const productInfo = productInfos.find((p) => p.id === item.typeId);
        if (!productInfo) return;

        const fullProductTypeInfoApply = fullProductTypeInfo.find(
          (n) => n.productTypeInfo?.id == productInfo.productTypeId
        );
        const exCalcItem = orderItemOnlineInfos[index];

        // Update item properties
        Object.assign(
          item,
          updateCartItem(
            item,
            productInfo,
            fullProductTypeInfoApply,
            exCalcItem,
            fullAttrs
          )
        );

        // Update item if FLS
        const flsProduct = flsProductInfos.find(
          (m: FlashSaleProductDetail) => m.productId == productInfo.id
        );
        if (flsProduct) {
          item.flashSaleProductId = flsProduct.id || 0;
        }

        // Update orderShips
        updateOrderShips(orderShips, item);
      })
    );

    // Calculate totals
    let {
      totalMoney,
      totalToppingsPrice,
      shipMoney,
      totalPriceProducts,
      pointPaid,
      discountCardCode,
      totalWeight,
    } = orderOnlineInfo;

    let totalAccumulatePoints = calculateTotalAccumulatePoints(cart);
    let totalDiscountVoucher = discountCardCode;

    // Apply voucher discount if applicable
    if (discountCode && discountVoucher) {
      const discountInfo = await calculateVoucherDiscount(
        discountVoucher,
        discountCode,
        customerId,
        totalPriceProducts
      );
      voucherInfo = discountInfo?.voucherInfo;
      totalDiscountVoucher += discountInfo.voucherDiscount;
      totalMoney -= discountInfo.voucherDiscount;
      isVoucherApply = discountInfo.voucherDiscount > 0;
    }

    // Prepare shipping service info
    if (shipServices) {
      const currentShipService = shipServices.find(
        (m: any) => m._id === shipInfo.shipServiceId
      );
      if (currentShipService) {
        shippingService.push({
          carrier_info: {
            image_url: currentShipService.icon_url,
            name: currentShipService.name,
          },
          estimated_delivery_at: moment().add(30, "minutes").valueOf(),
          fee: shipMoney,
        });
      }
    }

    return {
      orderPlace,
      flashSaleId,
      point: pointPaid,
      totalShipMoney: shipMoney,
      totalWeight,
      totalToppingsPrice,
      total: totalMoney,
      cash: totalPriceProducts,
      orderShips,
      totalPriceProducts,
      totalAccumulatePoints,
      shippingService,
      isVoucherApply,
      totalDiscount: totalDiscountVoucher,
      totalDiscountVoucher,
      discountInfo:
        discountVoucher && discountCode
          ? {
              voucherInfo,
              voucherApply: discountVoucher,
              voucherCodeApply: discountCode,
            }
          : null,
    };
  },
};
export default orderService;

const calculateOrderShip = ({
  customerId,
  inputObject,
  orderInfo,
  orderShips,
  shipInfo,
  reforderShipInfo,
  totalWeight,
  totalToppingsPrice,
  totalAccumulatePoints,
  total,
  cash,
  point,
  discountInfo,
  isVoucherApply = false,
  discount,
  remarks,
}: {
  customerId: number;
  inputObject: any;
  orderInfo: any;
  orderShips: any;
  shipInfo: any;
  reforderShipInfo: any;
  totalWeight: number;
  totalToppingsPrice: number;
  totalAccumulatePoints: number;
  total: number;
  cash: number;
  point: number;
  discountInfo: any;
  isVoucherApply: boolean;
  discount: number;
  remarks?: string;
}) => {
  const defaultOrderShips = orderShips[Object.keys(orderShips)[0]] || null;
  const storeInfo = defaultOrderShips?.storeInfo || null;
  const pathInfo = shipInfo.pathInfos;

  const defaultOrderShipInfo = {
    storeId: storeInfo?.id || 0,
    storeInfo,
    orderId: orderInfo.id,
    customerId,
    receiveName: pathInfo[1].name ?? "",
    receivePhone: pathInfo[1].phone ?? "",
    receiveEmail: "",
    receiveProvince: pathInfo[1].provinceName ?? "",
    receiveDistrict: pathInfo[1].districtName ?? "",
    receiveWard: pathInfo[1].wardName ?? "",
    receiveAddress: pathInfo[1].address ?? "",
    receiveProvinceId: pathInfo[1].provinceId,
    receiveDistrictId: pathInfo[1].districtId,
    receiveWardId: pathInfo[1].wardId,
    receiveLat: `${pathInfo[1].lat}`,
    receiveLng: `${pathInfo[1].lng}`,
    deliveryName: pathInfo[0].name ?? "",
    deliveryPhone: pathInfo[0].phone ?? "",
    deliveryProvince: pathInfo[0].provinceName ?? "",
    deliveryDistrict: pathInfo[1].districtName ?? "",
    deliveryWard: pathInfo[1].wardName ?? "",
    deliveryAddress: pathInfo[1].address ?? "",
    totalWeight,
    shipServiceCode: shipInfo?.shipServiceId,
    shipMoney: 0,
    shipCarrier: "",
    shipServiceName: "",
    mpoint: point,
    discountInfo,
    discountVoucherId: isVoucherApply ? inputObject?.discountVoucher : 0,
    discountCode: isVoucherApply ? inputObject?.discountCode : "",
    discount,
    paymentMethodShip: inputObject.methodPayment,
    moneyCash: cash,
    totalMoney: total,
    typeItem: "product",
    useStoreServiceShip: false,
    image: inputObject.cart[0].productInfo.images[0],
    typeShip: "mediaoneship",
    note: remarks || "",
    status: total > 0 ? "wait_payment" : "pending",
    totalToppingsPrice,
    totalAccumulatePoints,
  };

  return reforderShipInfo.map((ship: any) => ({
    ...defaultOrderShipInfo,
    shipMoney: ship.fee,
    shipCarrier: ship.carrier_info.name,
    shipServiceName: ship.carrier_info.name,
  }));
};

// Helper functions for calculate price
const updateCartItem = (
  item: any,
  productInfo: any,
  fullProductTypeInfo: any,
  exCalcItem: any,
  fullAttrs: any[]
) => {
  if (!exCalcItem) {
    console.log(`exCalcItem_not_found`, productInfo, exCalcItem);
    return item;
  }

  const updatedItem = { ...item };
  const {
    productTypeInfo,
    storeInfo,
    productAttributeValueInfos,
    attributeValueInfos,
    attributeInfos,
  } = fullProductTypeInfo;

  let toppings = [];
  if (exCalcItem.addOns?.length > 0) {
    for (const itemAddOn of exCalcItem.addOns) {
      for (const obj of productTypeInfo.toppings) {
        const matchingAddOn = obj.add_ons.add_ons.find(
          (addOn: any) => addOn.id === itemAddOn.addOnId
        );
        if (matchingAddOn) {
          toppings.push(matchingAddOn);
        }
      }
    }
  }

  updatedItem.toppings = toppings;
  updatedItem.itemPrice = updatedItem.paymentCash = exCalcItem.itemPrice;
  updatedItem.totalPrice =
    (exCalcItem.toppingsPrice + exCalcItem.itemPrice) * exCalcItem.quantity;
  updatedItem.toppingsPrice = exCalcItem.toppingsPrice;
  updatedItem.paymentPoint = 0;
  updatedItem.originPrice = productInfo.originPrice;
  updatedItem.weight = exCalcItem.weight;

  if (exCalcItem.flashsalePrice) {
    updatedItem.salePrice = exCalcItem.flashsalePrice;
    updatedItem.itemPrice = updatedItem.paymentCash = exCalcItem.flashsalePrice;
    updatedItem.totalPrice =
      (exCalcItem.toppingsPrice + exCalcItem.flashsalePrice) *
      exCalcItem.quantity;
  }

  updatedItem.isOriginPrice = updatedItem.originPrice > updatedItem.itemPrice;
  updatedItem.percentDecrease = Math.round(
    ((updatedItem.originPrice - updatedItem.itemPrice) /
      updatedItem.originPrice) *
      100
  );

  // Assign attribute info to product
  for (const pav of productAttributeValueInfos) {
    if (pav.productId === productInfo.id) {
      productInfo.attributeValueId = pav.attributeValueId;
      break;
    }
  }

  for (const av of attributeValueInfos) {
    if (av.id === productInfo.attributeValueId) {
      productInfo.attributeId = av.attributeId;
      productInfo.attributeValue = av.name;
      break;
    }
  }

  for (const ai of attributeInfos) {
    if (ai.id === productInfo.attributeId) {
      productInfo.attribute = ai.name;
      break;
    }
  }

  const atts = fullAttrs.filter((m) => m.id === productInfo.id);
  const attForProduct = atts.map((m) => ({ name: m.name, type: m.type }));

  updatedItem.attribute = productInfo.attribute || "";
  updatedItem.attributeValue = productInfo.attributeValue || "";
  updatedItem.attributes = attForProduct;
  updatedItem.payment = productInfo.payment;
  updatedItem.productInfo = productInfo;
  updatedItem.storeId = productInfo.storeId;
  updatedItem.productTypeId = productTypeInfo.id;
  updatedItem.accumlatePointType = productTypeInfo.accumlatePointType;

  if (updatedItem.accumlatePointType === "percent") {
    updatedItem.percentAccumlatePoints = productTypeInfo.valueAccumulatePoints;
  } else if (updatedItem.accumlatePointType === "value") {
    updatedItem.accumulatePoints = productTypeInfo.valueAccumulatePoints;
  }

  updatedItem.storeInfo = {
    id: storeInfo.id,
    name: storeInfo.name,
    logo: storeInfo.logo,
    mexchangeId: storeInfo.mexchangeId,
  };

  return updatedItem;
};

const updateOrderShips = (orderShips: any, item: any) => {
  if (!orderShips[item.storeId]) {
    orderShips[item.storeId] = {
      shipMoney: item.shipMoney || 0,
      moneyCash: item.paymentCash * item.quantity,
      totalToppingsPrice: item.toppingsPrice * item.quantity,
      discount: 0,
      mpoint: 0,
      useShipStore: item.useShipStore,
      storeInfo: item.storeInfo,
    };
  } else {
    orderShips[item.storeId].shipMoney += item.shipMoney || 0;
    orderShips[item.storeId].moneyCash += item.paymentCash * item.quantity;
    orderShips[item.storeId].totalToppingsPrice +=
      item.toppingsPrice * item.quantity;
  }
};

const calculateTotalAccumulatePoints = (cart: any[]) => {
  return cart.reduce((total, item) => {
    if (item.accumlatePointType === "percent") {
      return (
        total +
        ((item.cash || item.point) *
          item.percentAccumlatePoints *
          item.quantity) /
          100
      );
    } else if (item.accumlatePointType === "value") {
      return total + item.accumulatePoints * item.quantity;
    }
    return total;
  }, 0);
};

const calculateVoucherDiscount = async (
  _discountVoucher: number,
  _discountCode: string,
  _customerId: number,
  _totalPriceProducts: number
): Promise<{ voucherInfo: any; voucherDiscount: number }> => {
  // const voucherCodeInfo = await voucherService.getCodeInfo({
  //   voucherId: discountVoucher,
  //   code: discountCode,
  //   customerId,
  // });

  // if (
  //   !voucherCodeInfo ||
  //   totalPriceProducts <= (voucherCodeInfo.minAmountPayment || 0)
  // ) {
  //   return { voucherInfo: null, voucherDiscount: 0 };
  // }

  // const {
  //   voucherTypeDiscount,
  //   valueDiscount,
  //   valuePercentDiscount,
  //   valueMaxDiscount,
  // } = voucherCodeInfo;

  // let discount =
  //   voucherTypeDiscount === 1
  //     ? valueDiscount
  //     : (totalPriceProducts * (valuePercentDiscount || 0)) / 100;

  return {
    voucherInfo: null,
    voucherDiscount: 0, //Math.min(discount, valueMaxDiscount || Infinity),
  };
};

// Helper functions for create order
const calculateOrderPrice = async (
  params: CreateProductOrderParams,
  productInfos: any
) => {
  try {
    return await orderService.calculatePrice({
      cart: params.cart,
      productInfos,
      shipInfo: params.shipInfo,
      mpoint: params.mpointUse,
      discountCode: params.discountCode,
      discountVoucher: params.discountVoucher,
      customerId: params.customerId,
    });
  } catch (error: any) {
    if (error.message === "e_can_not_use_discount_code_shop") {
      throw ono("e_can_not_use_discount_code_shop");
    }
    throw error;
  }
};

const createOrderTransaction = async (
  params: CreateProductOrderParams,
  priceCalculation: any
) => {
  return prismaClient.$transaction(
    async (tx) => {
      const orderInfo = await createOrder(tx, params, priceCalculation);
      const orderShipInfos = await createOrderShips(
        tx,
        params,
        orderInfo,
        priceCalculation
      );
      const orderItemInfos = await createOrderItems(
        tx,
        params,
        orderInfo,
        orderShipInfos
      );
      return { orderItemInfos, orderInfo, orderShipInfos };
    },
    { maxWait: 30000, timeout: 50000 }
  );
};

const createOrder = async (
  tx: any,
  params: CreateProductOrderParams,
  priceCalculation: any
) => {
  const receiveInfo = params.shipInfo.pathInfos[1];
  return tx.order.create({
    data: {
      discount: priceCalculation.totalDiscount,
      totalMoney: priceCalculation.total,
      pointPaid: priceCalculation.point,
      moneyPaid: priceCalculation.cash,
      customerId: params.customerId,
      provinceId: receiveInfo.provinceId,
      districtId: receiveInfo.districtId,
      wardId: receiveInfo.wardId,
      receiveName: receiveInfo.name ?? "",
      receivePhone: receiveInfo.phone ?? "",
      address: receiveInfo.address ?? "",
      itemCount: params.cart.length,
      image: params.cart[0].productInfo?.images[0] ?? "",
      shipMoney: priceCalculation.totalShipMoney,
      methodPayment: params.methodPayment,
      typeItem: "product",
      orderPlace: priceCalculation.orderPlace,
      totalToppingsPrice: priceCalculation.totalToppingsPrice || 0,
      totalAccumulatePoints: priceCalculation.totalAccumulatePoints,
      discountCode:
        priceCalculation.isVoucherApply && priceCalculation.discountInfo
          ? priceCalculation.discountInfo.voucherCodeApply
          : "",
      discountVoucherId:
        priceCalculation.isVoucherApply && priceCalculation.discountInfo
          ? priceCalculation.discountInfo.voucherApply
          : 0,
      shipOrderCodeId: params.shipInfo.shipServiceId,
      note: params.remarks || "",
      flashSaleProductId: priceCalculation.flashSaleId,
    },
  });
};

const createOrderShips = async (
  tx: any,
  params: any,
  orderInfo: any,
  priceCalculation: any
) => {
  const orderShipToCreate = calculateOrderShip({
    customerId: params.customerId,
    inputObject: params,
    orderInfo,
    orderShips: priceCalculation.orderShips,
    shipInfo: params.shipInfo,
    reforderShipInfo: priceCalculation.shippingService,
    totalWeight: priceCalculation.totalWeight,
    totalToppingsPrice: priceCalculation.totalToppingsPrice || 0,
    totalAccumulatePoints: priceCalculation.totalAccumulatePoints || 0,
    total: priceCalculation.total,
    cash: priceCalculation.cash,
    point: priceCalculation.point,
    discountInfo: priceCalculation.discountInfo,
    isVoucherApply: priceCalculation.isVoucherApply,
    discount: priceCalculation.totalDiscount,
    remarks: params.remarks,
  });
  return Promise.all(
    orderShipToCreate.map((shipData: any) =>
      tx.ordership.create({ data: shipData })
    )
  );
};

const createOrderItems = async (
  tx: any,
  params: any,
  orderInfo: any,
  orderShipInfos: any
) => {
  const orderItemsToCreate = params.cart.map((item: any) =>
    createOrderItemData(item, orderInfo, params, orderShipInfos)
  );
  return Promise.all(
    orderItemsToCreate.map((itemData: any) =>
      tx.orderitem.create({ data: itemData })
    )
  );
};

const createOrderItemData = (
  cartItem: any,
  orderInfo: any,
  params: any,
  orderShipInfos: any[]
) => {
  const detail = cartItem.productInfo;
  const orderItem = {
    orderId: orderInfo.id,
    customerId: params.customerId,
    type: "product",
    typeId: cartItem.typeId,
    itemId: cartItem.itemId,
    mexchangeId: detail.mexchangeId,
    images: detail.images,
    name: detail.name,
    quantity: cartItem.quantity,
    totalPrice: cartItem.totalPrice,
    itemPrice: cartItem.itemPrice,
    shippPrice: cartItem.shipMoney || 0,
    point: cartItem.point || 0,
    cash: cartItem.cash || 0,
    status: "pending",
    cancelReason: "",
    amountAccumulatePoints: cartItem.accumulatePoints,
    attribute: cartItem.attribute || "",
    attributeValue: cartItem.attributeValue || "",
    productTypeId: cartItem.productTypeId,
    typeItem: "product",
    payment: cartItem.payment,
    flashSaleVoucherId: cartItem.flashSaleId || 0,
    discount: cartItem.discount || 0,
    storeId:
      cartItem.type === "product"
        ? cartItem.storeInfo?.id || cartItem.storeId
        : params.shipInfo.storeInfo.id,
    orderShipId: 0,
    flashSaleProductId: cartItem.flashSaleProductId || 0,
    toppings: cartItem.toppings || [],
  };
  orderItem.orderShipId = orderShipInfos[0]?.id || 0;
  // orderShipInfos.find((ship) => ship.storeId === orderItem.storeId)?.id || 0;
  return orderItem;
};

const updateOrderShipsWithItems = async (
  orderShipInfos: any[],
  orderItemInfos: any[]
) => {
  const updates = orderShipInfos.map((ship) => {
    const items = orderItemInfos.filter((item) => item.orderShipId === ship.id);
    return prismaClient.ordership.update({
      where: { id: ship.id },
      data: { orderItemInfos: items },
    });
  });
  await Promise.all(updates);
};
