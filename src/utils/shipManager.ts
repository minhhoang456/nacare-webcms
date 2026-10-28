import Conf from "@src/services/conf";
import request from "./request";
export interface getServiceRequest {
  senderAddress: string;
  receiverAddress: string;
  receiverProvince?: number;
  productWeight: number;
  productPrice: number;
  moneyCollection: string;
}

export interface estimateFeeRequest extends getServiceRequest {
  serviceId: string;
  serviceAdd: string;
}

export interface createOrderRequest {
  orderId: string;
  senderFullName: string;
  senderAddress: string;
  senderPhone: string;
  receiverFullName: string;
  receiverAddress: string;
  receiverPhone: string;
  /** Tên kiện hàng */
  productName: string;
  /** Mô tả (Cho xem hàng, thời gian giao hàng, ...) */
  productDescription: string;
  /** Số lượng sản phẩm trong kiện */
  productQuantity: number;
  /** Tổng giá trị sản phẩm trong kiện */
  productPrice: number;
  /** Tổng trọng lượng các sản phẩm trong kiện */
  productWeight: number;
  /** Phương thức thanh toán ONLINE | COD */
  paymentMethod: string | "ONLINE" | "COD";
  serviceId: string;
  serviceAdd: string;
  note: string;
  /** Số tiền thu hộ */
  moneyCollection: number;
  items: {
    productName: string;
    productQuantity: number;
    productPrice: number;
    productWeight: number;
  }[];
}

export interface cancelOrderRequest {
  orderId: string;
  refId: string;
  reason: string;
}
export default class ShipManager {
  private static instance: ShipManager;
  private config!: {
    baseUrl: string;
    apiKey: string;
    username: string;
    password: string;
  };
  private token!: string;

  private constructor() {
    this.loadConfig();

    setInterval(
      () => {
        console.log("Reloading ShipManager config...");
        this.loadConfig();
      },
      5 * 60 * 1000,
    );
  }

  static getInstance(): ShipManager {
    return (ShipManager.instance ??= new ShipManager());
  }

  private loadConfig() {
    this.config = {
      baseUrl: Conf.get("vtp.baseUrl", "https://shipgateway.mediaone.dev"),
      apiKey: Conf.get(
        "vtp.apiKey",
        "bXVhbXVhOkpGOHFLYm1nRHVaQzlONE1yUGM2VFY=",
      ),
      username: Conf.get("vtp.username", "muamua"),
      password: Conf.get("vtp.password", "JF8qKbmgDuZC9N4MrPc6TV"),
    };
    this.token = `Basic ${Buffer.from(
      `${this.config.username}:${this.config.password}`,
    ).toString("base64")}`;
  }

  private async makeRequest<T>(endpoint: string, params: any): Promise<T> {
    try {
      const rs = await request({
        method: "post",
        url: `${this.config.baseUrl}/api/ship/vtt/${endpoint}`,
        headers: {
          "Content-Type": "application/json",
          Authorization: this.token,
        },
        data: JSON.stringify(params),
      });

      if (!rs) {
        throw new Error("Request ship manager failed");
      }

      return rs.data;
    } catch (error) {
      throw new Error("Request ship manager failed");
    }
  }

  async getServices(parmas: getServiceRequest) {
    const dataParams = { ...parmas, receiverProvince: 1 };
    return this.makeRequest<{
      senderAddress: any;
      receiverAddress: any;
      results: {
        _id: string;
        name: string;
        code: string;
        price: number;
        estimatedTime: string;
        exchangeWeight: number;
        extraServices: { code: string; name: string }[];
      }[];
    }>("get-services", dataParams);
  }

  async estimateFee(parmas: estimateFeeRequest) {
    return this.makeRequest<{
      moneyTotal: number;
      moneyTotalFee: number;
      moneyFee: number;
      moneyCollectionFee: number;
      moneyOtherFee: number;
      moneyVat: number;
      kpiHt: number;
      exchangeWeight: number;
    }>("estimate-fee", parmas);
  }

  async createOrder(parmas: createOrderRequest) {
    return this.makeRequest<{
      createdAt: number;
      updatedAt: number;
      id: number;
      refId: string;
      orderId: string;
      status: number;
      statusDesc: string;
      moneyCollection: number;
      moneyTotal: number;
      moneyTotalFee: number;
      moneyFee: number;
      moneyCollectionFee: number;
      moneyVat: number;
      kpiHt: number;
      exchangeWeight: number;
      receiverProvince: number;
      receiverDistrict: number;
      receiverWards: number;
      items: {
        productName: string;
        productPrice: number;
        productQuantity: number;
        productWeight: number;
      }[];
    }>("create-order", parmas);
  }

  async cancelOrder(parmas: cancelOrderRequest) {
    return this.makeRequest<{
      code: number;
      message: string;
    }>("cancel-order", parmas);
  }
}
