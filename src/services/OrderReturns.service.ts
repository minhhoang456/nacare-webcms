import { ono } from "@jsdevtools/ono";
import { Prisma, prismaClient } from "../utils/prisma";
import ShipManager from "../utils/shipManager";
import { OrderPaymentStatusEnum } from "@prisma/client";

export const OrderReturnsService = {
  createShippingReturnOrder: async (orderReturnId: number) => {
    const returnOrder = await prismaClient.orderReturns.findUnique({
      where: {
        id: orderReturnId,
      },
    });
    if (!returnOrder) {
      throw new Error("Order return not found");
    }
    const orderShipInfo = await prismaClient.ordership.findFirst({
      where: {
        orderId: returnOrder.orderId,
      },
    });
    if (!orderShipInfo) {
      throw new Error("Order ship not found");
    }
    const orderItems = await prismaClient.orderitem.findMany({
      where: {
        id: {
          in: (returnOrder.orderItemInfos as any[]).map(
            (e) => e.id
          ) as number[],
        },
      },
    });
    const { shippingReturnOrder, orderShipReturn } =
      await prismaClient.$transaction(async (tx) => {
        const shippingReturnOrder = await tx.order.create({
          data: {
            returnForOrderId: returnOrder.orderId,
            customerId: returnOrder.customerId,
            typeOrder: "return_order",
            paymentStatus: OrderPaymentStatusEnum.processing,
          },
        });
        const orderShipReturn = await tx.ordership.create({
          data: {
            customerId: returnOrder.customerId,
            orderId: shippingReturnOrder.id,
            paymentMethodShip: "COD",
            typeItem: "returnOrder",
            shipMsg: [
              {
                time: new Date().getTime(),
                message: "Tạo đơn hàng hoàn",
              },
            ],
            status: OrderPaymentStatusEnum.processing,
            receiveAddress: orderShipInfo.deliveryAddress || "",
            receivePhone: orderShipInfo.deliveryPhone || "",
            receiveName: orderShipInfo.deliveryName || "",
            receiveEmail: orderShipInfo.deliveryEmail || "",
            deliveryAddress: orderShipInfo.receiveAddress || "",
            deliveryPhone: orderShipInfo.receivePhone || "",
            deliveryName: orderShipInfo.receiveName || "",
            deliveryEmail: orderShipInfo.receiveEmail || "",
            shipCarrier: "Viettel Post",
            shipCarrierImage:
              "https://static.doanhnhan.vn/images/upload/nhanpham/04102023/cach-tra-cuu-van-don-viettel-post-nhanh-chong-chinh-xac-202104070055588456.jpg",
            returnForOrderId: returnOrder.orderId,
          },
        });
        return { shippingReturnOrder, orderShipReturn };
      });
    const shipManager = ShipManager.getInstance();
    const totalWeight = orderItems.reduce(
      (acc, item) => acc + (item.totalWeight ?? 0),
      0
    );
    const productName = `${(orderItems as any[])
      ?.map(
        (item, index) =>
          `${index + 1}. ${item.name} - ${item.attributeValues} SL: ${item.quantity} \n`
      )
      .join(", ")}`;
    const shipServices = await shipManager.getServices({
      moneyCollection: "0",
      productPrice: returnOrder.totalProductPrice,
      productWeight: totalWeight,
      receiverAddress: orderShipInfo.deliveryAddress || "",
      senderAddress: orderShipInfo.receiveAddress || "",
    });
    if (shipServices.results.length === 0) {
      throw ono("e_can_not_find_ship_service");
    }
    const shipServiceInfo = shipServices.results[0];
    const result = await shipManager.createOrder({
      moneyCollection: 0,
      orderId: shippingReturnOrder.id.toString(),
      senderAddress: orderShipInfo.receiveAddress || "",
      paymentMethod: "ONLINE",
      note: "",
      productPrice: returnOrder.totalProductPrice,
      productWeight: totalWeight,
      receiverAddress: orderShipInfo.deliveryAddress || "",
      receiverFullName: orderShipInfo.deliveryName || "",
      receiverPhone: orderShipInfo.deliveryPhone || "",
      senderPhone: orderShipInfo.receivePhone || "",
      senderFullName: orderShipInfo.deliveryName || "",
      productQuantity: orderItems.reduce(
        (acc, item) => acc + (item.quantity ?? 0),
        0
      ),
      serviceId: shipServiceInfo._id || "",
      serviceAdd: "",
      items: orderItems.map((item) => {
        return {
          productName: item.name || "",
          productQuantity: item.quantity ?? 0,
          productPrice: item.itemPrice ?? 0,
          productWeight: item.totalWeight ?? 0,
        };
      }),
      productName,
      productDescription: `Đơn hàng hoàn hàng của cửa hàng ${orderShipInfo.deliveryName}`,
    });
    if (!result || !result.id) {
      await prismaClient.order.delete({
        where: {
          id: shippingReturnOrder.id,
        },
      });
      throw ono({
        code: "e_ship_order_failed",
        message: "Tạo đơn hàng thất bại",
      });
    }
    const statusOrder = OrderPaymentStatusEnum.wait_for_pickup;
    const shipMessages: any = orderShipReturn.shipMsg;
    shipMessages.push({
      time: new Date().getTime(),
      message: "Nguời gửi đang chuẩn bị hàng",
    });
    const dataUpdateOrderShip: Prisma.ordershipUpdateInput = {
      shipOrderCodeId: result.refId,
      status: statusOrder,
      shipMsg: shipMessages,
      shipServiceName: shipServiceInfo.name,
    };
    const dataUpdateOrder: Prisma.orderUpdateInput = {
      paymentStatus: statusOrder,
    };
    await prismaClient.$transaction(async (tx) => {
      await tx.ordership.update({
        where: { id: orderShipReturn.id },
        data: dataUpdateOrderShip,
      });
      await tx.order.update({
        where: { id: shippingReturnOrder.id },
        data: dataUpdateOrder,
      });
    });
  },
  completeShippingReturnOrder: async (orderReturnId: number) => {
    const returnOrder = await prismaClient.orderReturns.findUnique({
      where: {
        id: orderReturnId,
      },
    });
    if (!returnOrder) {
      throw new Error("Order return not found");
    }
    await prismaClient.orderReturns.update({
      where: {
        id: orderReturnId,
      },
      data: {
        status: "WAITING_MONEY_RETURN",
      },
    });
  },

  countOrderReturns: async (where: Prisma.OrderReturnsWhereInput) => {
    const data = await prismaClient.orderReturns.groupBy({
      by: ["status"],
      where,
      _count: true,
    });
    return data.reduce(
      (acc, item) => {
        acc[item.status] = item._count;
        return acc;
      },
      {} as Record<string, number>
    );
  },
};
export default OrderReturnsService;
