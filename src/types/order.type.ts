import { depot, product } from "@prisma/client";

export type ParamsCalculatePriceOrder = {
  productsInfo: (product & {
    quantity: number;
    productId: number;
    flashSaleProductId?: number;
    salePrice?: number;
    attributeValues?: string;
  })[];
  serviceShipId?: string;
  fullAddress: string;
  flashSaleIdsNotEnoughQuantity: number[];
  depotInfo: depot;
  voucherCode?: string;
  customerId: number;
  consumptionPointUsed?: number;
  commissionWalletUsed?: number;
};

export type ParamsCreateOrder = {
  productsInfo: { productId: number; quantity: number }[];
  provinceId: number;
  districtId: number;
  wardId: number;
  serviceShipId?: number;
  address: string;
  paymentMethod: "cod" | "online";
};

export const MessageConfirmOrder: any = {
  e_permission_denied: "Bạn không có quyền thực hiện hành động này",
  e_order_ship_not_found: "Đơn hàng không tồn tại",
  e_order_ship_status_invalid: "Trạng thái đơn hàng không hợp lệ",
  e_payment_transaction_not_found: "Không tìm thấy giao dịch thanh toán",
  e_ship_order_failed: "Tạo đơn hàng thất bại. Vui lòng thử lại",
};
