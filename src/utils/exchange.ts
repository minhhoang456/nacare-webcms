import Conf from "@src/services/conf";
import { prismaClient } from "./prisma";
import request from "./request";

class ExchangeService {
  private baseUrl!: string;
  private authToken!: string;
  private defaultPartnerId!: string;
  private defaultStoreId!: string;

  constructor() {
    this.loadConfig();

    setInterval(
      () => {
        console.log("Reloading ExchangeService config...");
        this.loadConfig();
      },
      5 * 60 * 1000,
    );
  }

  private loadConfig() {
    this.baseUrl = Conf.get("MEXCHANGE_HOST", "https://dev.mexchange.vn");
    this.authToken = Conf.get(
      "MEXCHANGE_SECRET",
      "1dc5f4a1-5ae5-4901-9d4d-162da4e5c444",
    );
    this.defaultPartnerId = Conf.get(
      "MEXCHANGE_PARTNER_ID",
      "parcu46ibntn1cciqoeaam0",
    );
    this.defaultStoreId = Conf.get(
      "MEXCHANGE_STORE_ID",
      "stocu46l37tn1cciqoeaan0",
    );
  }

  private getHeaders() {
    return {
      "content-type": "application/json",
      Authorization: `Basic ${this.authToken}`,
    };
  }

  async syncUpsertVoucher(voucherInfo: any) {
    try {
      const data: any = {
        ...(voucherInfo.voucherId && { id: voucherInfo.voucherId }),
        category: "shopping",
        alt_id: `${voucherInfo.id}`,
        partner_id: this.defaultPartnerId,
        partner_refer_by: "",
        store_ids: [this.defaultStoreId],
        name: `Nacare | ${voucherInfo.name}`,
        images:
          voucherInfo?.imagesVoucher?.length > 0
            ? voucherInfo?.imagesVoucher
            : [voucherInfo.image],
        thumb: voucherInfo.thumb,
        title: voucherInfo.name,
        description: voucherInfo.description,
        points: voucherInfo.paymentPoints,
        hashtags: "Nacare",
        zone: "Toàn quốc",
        start_at: voucherInfo.startDate,
        end_at: voucherInfo.endDate,
        price: voucherInfo.price,
        ...(voucherInfo?.codeTimeType == "DAYS" && {
          code_expired_duration: Number(voucherInfo.codeTime) * 86400,
        }),
        ...(voucherInfo?.codeTimeType == "DATE" && {
          code_expired_at: voucherInfo.codeTime,
        }),
        ...(voucherInfo?.voucherTypeDiscount == 1 && {
          discount_cash_value: voucherInfo.valueDiscount,
        }),
        ...(voucherInfo?.voucherTypeDiscount == 2 && {
          reduce_percents: voucherInfo.valuePercentDiscount,
        }),
        ...(voucherInfo?.valueMaxDiscount && {
          max_discount_cash_value: voucherInfo.valueMaxDiscount,
        }),
        ...(voucherInfo?.minAmountPayment && {
          min_total_bill_value: voucherInfo.minAmountPayment,
        }),
        applicable_object: "all",
        apply_sale_types: "all",
      };
      const options = {
        method: "POST",
        url: `${this.baseUrl}/api2/push-voucher`,
        headers: this.getHeaders(),
        data,
      };
      return await request(options);
    } catch (error) {
      throw error;
    }
  }

  async syncCodeState({ codeInfo }: { codeInfo: any }) {
    try {
      const code = await prismaClient.code.findFirst({
        where: {
          code: codeInfo.code,
          voucherId: codeInfo.voucherId,
        },
      });
      if (!code || (code && !code.voucherRefId)) return;

      const options = {
        method: "GET",
        uri: `${this.baseUrl}/api2/exchange/webhook/merchant`,
        headers: this.getHeaders(),
        data: {
          type: "upsert_status_code",
          codeInfo: {
            voucherId: code.voucherRefId,
            status: "used",
            customerPhone: codeInfo.phone,
            code: codeInfo.code,
            usedAt: codeInfo.usedAt,
          },
        },
      };
      await request(options);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export default new ExchangeService();
