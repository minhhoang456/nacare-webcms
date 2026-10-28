// VNPayQR Type Definitions
// Based on VNPay Payment Gateway API Specification

export type NetworkType =
  | "VietQR"
  | "VNPAYQR"
  | "NAPAS"
  | "VISA"
  | "MASTER"
  | "JCB";

export type Language = "vi" | "en";

// Main Configuration Interface
export interface VNPayConfig {
  tmnCode: string;
  hashSecret: string;
  vnpUrl: string;
  apiUrl: string;
  returnUrl: string;
}

export interface VNPayRefundRequest {
  requestId: string;
  transactionType: "02" | "03";
  txnRef: string;
  amount: number;
  transactionNo?: string;
  transactionDate: string;
  createBy: string;
  createDate: string;
  ipAddr: string;
  orderInfo: string;
}

export interface VNPayRefundResponse {
  vnp_ResponseId: string;
  vnp_Command?: string;
  vnp_TmnCode?: string;
  vnp_TxnRef: string;
  vnp_Amount: string;
  vnp_OrderInfo: string;
  vnp_ResponseCode: string;
  vnp_Message: string;
  vnp_BankCode?: string;
  vnp_PayDate?: string;
  vnp_TransactionNo?: string;
  vnp_TransactionType?: string;
  vnp_TransactionStatus?: string;
  vnp_SecureHash?: string;
}

// Create Transaction API Types
export interface VNPayCreateTransactionRequest {
  transAmount: number;
  description: string;
  txnRef: string;
  ipAddr: string;
  bankCode?: string;
  returnUrl?: string;
}

// Payment Notification API Types (IPN - VNPay sends to Partner)
export interface VNPayIPNRequest {
  vnp_Amount: string;
  vnp_BankCode: string;
  vnp_BankTranNo?: string;
  vnp_CardType: string;
  vnp_OrderInfo: string;
  vnp_PayDate: string;
  vnp_ResponseCode: string;
  vnp_TmnCode: string;
  vnp_TransactionNo: string;
  vnp_TransactionStatus: string;
  vnp_TxnRef: string;
  vnp_SecureHash: string;
  [key: string]: any;
}

export interface VNPayIPNResponse {
  RspCode:
    | "00"
    | "07"
    | "09"
    | "10"
    | "11"
    | "12"
    | "13"
    | "24"
    | "51"
    | "65"
    | "75"
    | "79"
    | "99";
  Message: string;
}

// Validation Types
export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
}

export interface VNPaymentNotificationResponse {
  RspCode: "00" | "01" | "02" | "04" | "97" | "99";
  Message: string;
}
