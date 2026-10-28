import type { Prisma } from "@prisma/client";
import type { prismaClient } from "../utils/prisma";

type RepurchaseTx = Parameters<
  Parameters<typeof prismaClient.$transaction>[0]
>[0];

export type ReserveRepurchaseStock = (itemId: number) => Promise<void>;

// Mục 4: tạo đơn bằng tiền đã trích, không đụng lại ví tiền/điểm hay cổng thanh toán.
// Hàm chỉ dùng transaction được truyền vào để có thể kiểm thử hoàn toàn bằng DB giả.
export async function completeRepurchase(
  tx: RepurchaseTx,
  id: bigint,
  reserveStock: ReserveRepurchaseStock,
) {
  await tx.$queryRaw`SELECT id FROM "commissionRepurchase" WHERE id = ${id} FOR UPDATE`;
  const request = await tx.commissionRepurchase.findUniqueOrThrow({
    where: { id },
  });
  if (request.status === "completed") return request.orderId;
  if (request.orderId)
    throw new Error("Yêu cầu tái mua đã có đơn nhưng chưa hoàn tất");
  if (!["pending", "failed"].includes(request.status)) return null;
  if (request.ruleType !== "positive")
    throw new Error("Loại tái mua không hợp lệ");
  const amount = Number(request.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647) {
    throw new Error("Giá trị tái mua không hợp lệ");
  }
  const products = await tx.product.findMany({
    where: {
      paymentCash: amount,
      payment: "cash",
      paymentPoint: 0,
      isActive: true,
      isDelete: false,
    },
    orderBy: { id: "asc" },
    take: 2,
  });
  if (products.length !== 1) {
    throw new Error(
      products.length === 0
        ? `Không có sản phẩm đang bán giá ${amount}đ để tái mua`
        : `Có nhiều sản phẩm giá ${amount}đ, cần xác định duy nhất sản phẩm tái mua`,
    );
  }
  const product = products[0];
  const [customer, productType, store] = await Promise.all([
    tx.customer.findUnique({ where: { id: request.customerId } }),
    tx.productType.findUnique({ where: { id: product.productTypeId } }),
    tx.store.findUnique({ where: { id: product.storeId } }),
  ]);
  if (
    !customer ||
    !productType?.isActive ||
    !productType.isApprove ||
    !store ||
    store.state === false
  ) {
    throw new Error("Khách hàng, sản phẩm hoặc cửa hàng tái mua không hợp lệ");
  }
  // Dùng cùng cơ chế giữ hàng Redis với đơn mua thường; rollback được xử lý ở lớp bao transaction.
  await reserveStock(product.itemId);
  await tx.item.update({
    where: { id: product.itemId },
    data: { purchased: { increment: 1 } },
  });
  const now = BigInt(Date.now());
  const source = "commission_positive_repurchase";
  const note = `Tái mua thưởng tích cực - yêu cầu #${id}`;
  const orderUniqueId = `commission-repurchase-${id}`;
  const images = Array.isArray(product.images) ? product.images : [];
  const image = typeof images[0] === "string" ? images[0] : "";
  const order = await tx.order.create({
    data: {
      customerId: request.customerId,
      totalMoney: amount,
      moneyPaid: 0,
      pointPaid: 0,
      consumptionPointUsed: BigInt(0),
      shipMoney: 0,
      discount: 0,
      itemCount: 1,
      receiveName: customer.name || "",
      receivePhone: customer.phone || "",
      image,
      paymentStatus: "completed",
      timeCompletedOrder: now,
      canCancelOrder: false,
      sourceOrder: source,
      typeOrder: "customer",
      typeItem: "product",
      orderPlace: "none",
      orderUniqueId,
      note,
      // methodPayment để null: đây là nguồn tiền tái mua, không phải online/COD/điểm tiêu dùng.
    },
  });
  const ship = await tx.ordership.create({
    data: {
      orderId: order.id,
      customerId: request.customerId,
      storeId: product.storeId,
      storeInfo: {
        id: store.id,
        name: store.name,
        phone: store.phone,
        address: store.address,
      },
      receiveName: customer.name || "",
      receivePhone: customer.phone || "",
      totalMoney: amount,
      moneyCash: 0,
      mpoint: 0,
      consumptionPointUsed: BigInt(0),
      shipMoney: 0,
      totalWeight: product.weight,
      paymentMethodShip: "commission_repurchase",
      status: "completed",
      timeCompletedOrder: now,
      typeShip: "none",
      orderPlace: "none",
      typeItem: "product",
      orderUniqueId,
      note,
      image,
      shipMsg: [
        {
          time: Number(now),
          message: "Hoàn tất đơn bằng khoản tiền tái mua đã tích lũy",
        },
      ],
    },
  });
  const item = await tx.orderitem.create({
    data: {
      orderId: order.id,
      orderShipId: ship.id,
      customerId: request.customerId,
      type: "product",
      typeItem: "product",
      typeId: product.id,
      productTypeId: product.productTypeId,
      itemId: product.itemId,
      name: product.name,
      images: product.images as Prisma.InputJsonValue,
      quantity: 1,
      itemPrice: amount,
      totalPrice: amount,
      cash: 0,
      point: 0,
      payment: "commission_repurchase",
      status: "completed",
      storeId: product.storeId,
      totalWeight: product.weight,
      note,
    },
  });
  // Snapshot JSON không chứa BigInt do Prisma thêm createdAt/updatedAt.
  const itemSnapshot = JSON.parse(
    JSON.stringify(item, (_key, value) =>
      typeof value === "bigint" ? Number(value) : value,
    ),
  );
  await tx.ordership.update({
    where: { id: ship.id },
    data: { orderItemInfos: [itemSnapshot] },
  });
  await tx.commissionRepurchase.update({
    where: { id },
    data: {
      orderId: order.id,
      status: "completed",
      errorMessage: null,
      attempts: { increment: 1 },
    },
  });
  return order.id;
}

// Chỉ xử lý yêu cầu của lần tính hiện tại; khóa từng bản ghi chống chạy trùng.
export async function completeRepurchasesForDate(
  tx: RepurchaseTx,
  calculationDate: string,
  reserveStock: ReserveRepurchaseStock,
) {
  const requests = await tx.commissionRepurchase.findMany({
    where: { calculationDate, status: { in: ["pending", "failed"] } },
    orderBy: { id: "asc" },
  });
  for (const request of requests)
    await completeRepurchase(tx, request.id, reserveStock);
}

// Hoàn trả giữ hàng nếu bất kỳ bước DB nào thất bại; thành công giữ nguyên purchased như đơn thường.
export async function withRepurchaseStock<T>(
  stock: {
    hold: ReserveRepurchaseStock;
    release: (
      items: { itemId: number; quantity: number }[],
    ) => Promise<unknown>;
  },
  work: (reserve: ReserveRepurchaseStock) => Promise<T>,
): Promise<T> {
  const held: { itemId: number; quantity: number }[] = [];
  try {
    return await work(async (itemId) => {
      await stock.hold(itemId);
      held.push({ itemId, quantity: 1 });
    });
  } catch (error) {
    if (held.length) await stock.release(held);
    throw error;
  }
}
