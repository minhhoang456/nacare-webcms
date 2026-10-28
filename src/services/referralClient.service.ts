import { prismaClient } from "../utils/prisma";
import request from "../utils/request";
import {
  DailyCommissionRequest,
  DailyCommissionResult,
  ReferralEdge,
  ReferralListResponse,
  ReferralServiceResponse,
} from "../types/commission.type";

async function getCredential(): Promise<{
  username: string;
  password: string;
}> {
  // Xác thực service-to-service dùng trực tiếp cấu hình basic_auth do backend
  // chính quản lý; environment chỉ lưu URL của referral service.
  const credential = await prismaClient.basicAuth.findFirst({
    where: { username: "nacare", state: true },
    select: { username: true, password: true },
  });
  if (!credential?.username || !credential.password) {
    throw new Error("nacare basic auth credential was not found");
  }
  return {
    username: credential.username,
    password: credential.password,
  };
}

async function call<T>(method: "GET" | "POST", path: string, data?: unknown) {
  const baseURL = process.env.REFERRAL_SERVICE_URL;
  if (!baseURL) throw new Error("REFERRAL_SERVICE_URL is not configured");
  const credential = await getCredential();
  const response = (await request({
    method,
    url: `${baseURL.replace(/\/$/, "")}${path}`,
    auth: credential,
    timeout: 120000,
    data,
  })) as ReferralServiceResponse<T>;
  return response;
}

export const referralClientService = {
  // Cây giới thiệu: customerId lấy từ access token ở backend chính; client
  // không được phép truyền customerId của một người khác.
  createReferral: async (
    referrerInviteCode: string,
    referredCustomerId: number,
  ) =>
    call<ReferralEdge>("POST", "/api/referral", {
      referrerInviteCode,
      referredCustomerId,
    }),

  // Danh sách F1 của customer; limit/skip chỉ phân trang nhánh trực tiếp.
  listDirectReferrals: async (
    referrerCustomerId: number,
    limit: number,
    skip: number,
    isActive?: boolean,
    phone?: string,
  ) => {
    const query = new URLSearchParams({
      referrerCustomerId: String(referrerCustomerId),
      limit: String(limit),
      skip: String(skip),
    });
    if (isActive !== undefined) {
      query.set("isActive", String(isActive));
    }
    if (phone) {
      query.set("phone", phone);
    }
    return call<ReferralListResponse<ReferralEdge>>(
      "GET",
      `/api/referral?${query.toString()}`,
    );
  },

  // Mục 1-7: gửi snapshot trong ngày sang Go service để tính thuần túy.
  calculateDailyCommission: async (
    payload: DailyCommissionRequest,
  ): Promise<DailyCommissionResult> => {
    const response = await call<DailyCommissionResult>(
      "POST",
      "/api/commission/calculate",
      payload,
    );
    if (response.code !== 0 || !response.data) {
      throw new Error(response.message || "referral service returned no data");
    }
    return response.data;
  },
};

export default referralClientService;
