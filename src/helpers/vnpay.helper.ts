import Conf from "@src/services/conf";
import crypto from "crypto";
import moment from "moment";
import {
  VNPayConfig,
  VNPayCreateTransactionRequest,
  VNPayRefundRequest,
  VNPayRefundResponse,
} from "../types/vnpay.type";
import request from "../utils/request";

// Security Functions
const generateSignature = (params: any): string => {
  const sortedKeys = Object.keys(params).sort();
  return sortedKeys
    .filter(
      (key) =>
        params[key] !== "" && params[key] !== undefined && params[key] !== null,
    )
    .map((key) => {
      return (
        encodeURIComponent(key) +
        "=" +
        encodeURIComponent(params[key]).replace(/%20/g, "+")
      );
    })
    .join("&");
};

const hmacSha512 = (data: string, secret: string): string => {
  return crypto
    .createHmac("sha512", secret)
    .update(data, "utf-8")
    .digest("hex");
};

const verifySignature = async (vnp_Params: any): Promise<boolean> => {
  try {
    const config = getConfig();
    const vnp_SecureHash = vnp_Params["vnp_SecureHash"];

    // Xóa các tham số không tham gia ký
    delete vnp_Params["vnp_SecureHash"];
    delete vnp_Params["vnp_SecureHashType"];

    const signData = generateSignature(vnp_Params);
    console.log("signData at verify", signData);

    const signed = hmacSha512(signData, config.hashSecret);

    return (
      String(vnp_SecureHash).toLowerCase() === String(signed).toLowerCase()
    );
  } catch (error) {
    console.error("Error verifying signature:", error);
    return false;
  }
};

const getConfig = (): VNPayConfig => {
  const tmnCode = Conf.get("VNPayQR.TmnCode", "NATCTE15");
  const hashSecret = Conf.get(
    "VNPayQR.HashSecret",
    "K1UPJ2W5I0XERH3V8PF4F9TFG72MM8KP",
  );
  const vnpUrl = Conf.get(
    "VNPayQR.VNPUrl",
    "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
  );
  const apiUrl = Conf.get(
    "VNPayQR.ApiUrl",
    "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction",
  );
  const returnUrl = Conf.get(
    "VNPayQR.ReturnUrl",
    `${Conf.get("BACKEND_URL")}/api/payment/vnpay/return`,
    // `http://localhost:7879/api/payment/vnpay/return`
  );
  return {
    tmnCode: String(tmnCode),
    hashSecret: String(hashSecret),
    vnpUrl: String(vnpUrl),
    apiUrl: String(apiUrl),
    returnUrl: String(returnUrl),
  };
};

// API Client Functions
const createPaymentUrl = async (
  transactionRequest: VNPayCreateTransactionRequest,
  config: VNPayConfig,
) => {
  try {
    // Prepare request body
    const createDate = moment(new Date()).format("YYYYMMDDHHmmss");
    const vnpUrl = config.vnpUrl;
    const vnp_Params: any = {
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: config.tmnCode,
      vnp_Locale: "vn",
      vnp_CurrCode: "VND",
      vnp_TxnRef: transactionRequest.txnRef,
      vnp_OrderInfo: transactionRequest.description,
      vnp_OrderType: "other",
      vnp_Amount: transactionRequest.transAmount * 100, // VNPay nhân 100
      vnp_ReturnUrl: transactionRequest.returnUrl,
      vnp_IpAddr: transactionRequest.ipAddr,
      vnp_CreateDate: createDate,
    };
    const signData = generateSignature(vnp_Params);

    const signed = hmacSha512(signData, config.hashSecret);
    vnp_Params["vnp_SecureHash"] = signed;
    return vnpUrl + "?" + generateSignature(vnp_Params);
  } catch (error) {
    console.error("Error creating transaction:", error);
    throw error;
  }
};

const createRefundSecureHash = (
  refundRequest: VNPayRefundRequest,
  config: VNPayConfig,
): string => {
  const checksumData = [
    refundRequest.requestId,
    "2.1.0",
    "refund",
    config.tmnCode,
    refundRequest.transactionType,
    refundRequest.txnRef,
    refundRequest.amount * 100,
    refundRequest.transactionNo || "",
    refundRequest.transactionDate,
    refundRequest.createBy,
    refundRequest.createDate,
    refundRequest.ipAddr,
    refundRequest.orderInfo,
  ].join("|");

  return hmacSha512(checksumData, config.hashSecret);
};

const refundTransaction = async (
  refundRequest: VNPayRefundRequest,
  config: VNPayConfig,
): Promise<VNPayRefundResponse> => {
  const requestPayload = {
    vnp_RequestId: refundRequest.requestId,
    vnp_Version: "2.1.0",
    vnp_Command: "refund",
    vnp_TmnCode: config.tmnCode,
    vnp_TransactionType: refundRequest.transactionType,
    vnp_TxnRef: refundRequest.txnRef,
    vnp_Amount: refundRequest.amount * 100,
    vnp_OrderInfo: refundRequest.orderInfo,
    vnp_TransactionNo: refundRequest.transactionNo || "",
    vnp_TransactionDate: refundRequest.transactionDate,
    vnp_CreateBy: refundRequest.createBy,
    vnp_CreateDate: refundRequest.createDate,
    vnp_IpAddr: refundRequest.ipAddr,
    vnp_SecureHash: createRefundSecureHash(refundRequest, config),
  };

  const response = await request({
    method: "POST",
    url: config.apiUrl,
    headers: { "Content-Type": "application/json" },
    data: requestPayload,
    timeout: 30000,
  });

  if (!response || typeof response !== "object") {
    throw new Error("Invalid VNPay refund response");
  }

  return response as VNPayRefundResponse;
};

const vnpayHelper = {
  verifySignature,
  getConfig,
  createPaymentUrl,
  refundTransaction,
};

export default vnpayHelper;
