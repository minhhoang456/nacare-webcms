import ono from "@jsdevtools/ono";
import redis from "@root/src/utils/redis";
import Conf from "@src/services/conf";
import cryptUtils from "@src/utils/crypt";
import { RawAxiosRequestConfig } from "axios";
import {
  generateOTP,
  getCompiledTemplate,
  isEmail,
  isPhone,
} from "../helpers/func.helper";
import { generateUniqueCustomerInviteCode } from "../helpers/inviteCode.helper";
import { SENDER_TYPE } from "../types/chat.type";
import { Prisma, prismaClient } from "../utils/prisma";
import request from "../utils/request";
import { getConsumptionPointBalance } from "./consumptionPoint.service";
import { getCommissionWalletAvailable } from "./commissionWalletOrderPayment.service";

export const customerService = {
  bootstrap: async () => {
    try {
      await customerService.updatePhonePrefixFrom84To0();
    } catch (error) {
      console.log(
        "🚀 ~ file: customer.service.ts:637 ~ bootstrap: ~ error",
        error,
      );
    }
  },

  checkCustomerIsBlock: async (customerId: number) => {
    const result = await redis.hexists("block_customer", String(customerId));
    if (result === 1) {
      throw ono({
        code: "e_user_blocked",
      });
    }
  },

  addCustomerToBlackList: async (customerId: number) => {
    await redis.hmset("block_customer", customerId, 1);
  },

  removeCustomerFromBlackList: async (customerId: number) => {
    await redis.hdel("block_customer", String(customerId));
  },

  initBlockCustomer: async () => {
    const multi = redis.multi();
    multi.del("block_customer");
    const customerIds = await prismaClient.customer.findMany({
      select: {
        id: true,
      },
      where: {
        isBlock: true,
      },
    });
    if (customerIds.length > 0) {
      const customers: any = {};
      customerIds.forEach((e) => {
        customers[e.id] = 1;
      });
      multi.hmset("block_customer", customers);
    }
    await multi.exec();
  },

  afterUpdate: async (inst: any) => {
    const result = await redis.hexists("block_customer", inst.id);
    if (result === 1 && inst.isBlock === false) {
      await customerService.removeCustomerFromBlackList(inst.id);
    }
    if (result === 0 && inst.isBlock === true) {
      await customerService.addCustomerToBlackList(inst.id);
    }
    return inst;
  },

  beforeCreate: async (inst: any) => {
    try {
      // inst.codeInvite = sails.services.crypt.generateCodeChar(1, Conf.get("CODE_INVITE_LENGTH", 8))[0]
    } catch (err) {
      console.log("🚀 ~ file: Customer.js:122 ~ beforeCreate: ~ err", err);
    }
    return inst;
  },

  // End BlockCustomer

  getCustomerKey: (customerId: number) => {
    return `customer_info_${customerId}`;
  },

  getCustomerRef: (merchantRef: string) => {
    return `customer_ref_${merchantRef}`;
  },

  createTokenMerchant: (customerId: number, merchantId: number) => {
    const input = { customerId, merchantId, scope: "customer" };
    const token = cryptUtils.signJwt(
      input,
      Conf.get("CUSTOMER_MERCHANT_TOKEN_TTL", 86400),
    );
    return token;
  },

  // End Client using
  createToken: (customerId: number) => {
    const input = { customerId, scope: "customer" };
    const token = cryptUtils.signJwt(
      input,
      Conf.get("CUSTOMER_TOKEN_TTL", 864000000),
    );
    return token;
  },

  verifyCustomerToken: (token: string) => {
    const tokenInfo: any = cryptUtils.verifyJwt(token);
    if (tokenInfo.data.scope !== "customer")
      throw ono({
        code: "e_invalid_scope",
      });
    return tokenInfo.data;
  },

  createTokenChat: (typeId: number, type: SENDER_TYPE, storeId?: number) => {
    const input = { typeId, type, scope: "chat", storeId };
    const token = cryptUtils.signJwt(
      input,
      Conf.get("CHAT_TOKEN_TTL", 864000000),
    );
    return token;
  },

  verifyTokenChat: (token: string) => {
    const tokenInfo: any = cryptUtils.verifyJwt(token);
    if (tokenInfo.data.scope !== "chat")
      throw ono({
        code: "e_invalid_scope",
      });
    return tokenInfo.data;
  },

  checkCustomerExists: async (customerId: number) => {
    const info = await prismaClient.customer.findUnique({
      where: { id: customerId },
    });
    if (info) return true;
    return false;
  },

  async createCustomer(input: any) {
    if (!input.inviteCode) {
      input.inviteCode = await generateUniqueCustomerInviteCode(prismaClient);
    }
    const tmp: any = {};
    const customerFields: any = Object.values(Prisma.CustomerScalarFieldEnum);
    for (const i in customerFields) {
      if (!input[customerFields[i]]) continue;
      tmp[customerFields[i]] = input[customerFields[i]];
    }
    input = tmp;
    const genderMap: any = { 1: "male", 2: "female" };
    input.gender = input.gender ? genderMap[input.gender] : "other";
    // const exchangeInfo = await this.createExchangeInfo(input);
    // input.exchangeId = exchangeInfo.customerInfo.id;
    // input.mpoint = exchangeInfo.customerInfo.balance;
    // input.totalMpoint = exchangeInfo.customerInfo.total;
    // input.ownPoint = exchangeInfo.merchantPoint;
    const customerInfo = await prismaClient.customer.create({
      data: input,
    });
    await redis.set(
      this.getCustomerKey(input.id),
      JSON.stringify(input),
      "EX",
      Conf.get(`CACHE_TIME_LONG`),
    );
    return customerInfo;
  },

  async createExchangId(input: any) {
    const exchangeInfo = await this.createExchangeInfo(input);
    input.exchangeId = exchangeInfo.customerInfo.id;
    input.mpoint = exchangeInfo.customerInfo.balance;
    input.totalMpoint = exchangeInfo.customerInfo.total;
    input.ownPoint = exchangeInfo.merchantPoint;
    await prismaClient.customer.update({
      where: {
        id: input.id,
      },
      data: {
        mpoint: exchangeInfo.balance,
        totalMpoint: exchangeInfo.total,
      },
    });
    await redis.set(
      this.getCustomerKey(input.id),
      JSON.stringify(input),
      "EX",
      Conf.get(`CACHE_TIME_LONG`),
    );
  },

  // getInitPoint: async (customerId) => { },
  createExchangeInfo: async (customerInfo: any, prismaTrans?: any) => {
    try {
      const options: RawAxiosRequestConfig = {
        method: "POST",
        url: `${Conf.get(
          "MEXCHANGE_HOST",
          "https://dev.mexchange.vn",
        )}/api2/customer/create-merchant-customer`,
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${Conf.get(
            "MEXCHANGE_SECRET",
            "f7af4bc5-c32f-4e94-9426-f59acb31408c",
          )}`,
        },
        data: JSON.stringify({
          refId: customerInfo.phone || customerInfo.merchantRef,
          phone: customerInfo.phone || customerInfo.merchantRef,
        }),
      };
      // eslint-disable-next-line handle-callback-err
      const exchangeInfo = await request(options);
      if (
        exchangeInfo.customerInfo.id !== customerInfo.exchangeId &&
        customerInfo.id
      ) {
        if (prismaTrans) {
          await prismaTrans.customer.update({
            where: {
              id: customerInfo.id,
            },
            data: {
              exchangeId: exchangeInfo.customerInfo.id,
              mpoint: exchangeInfo.customerInfo.balance,
              totalMpoint: exchangeInfo.customerInfo.total,
            },
          });
        } else {
          await prismaClient.customer.update({
            where: {
              id: customerInfo.id,
            },
            data: {
              exchangeId: exchangeInfo.customerInfo.id,
              mpoint: exchangeInfo.customerInfo.balance,
              totalMpoint: exchangeInfo.customerInfo.total,
            },
          });
        }

        await redis.del(`customer_info_${customerInfo.id}`);
      }
      return exchangeInfo;
    } catch (error) {
      throw ono({
        code: "e_cannot_create_exchange_info",
      });
    }
  },

  updateExchangeInfo: async (customerInfo: any) => {
    try {
      const options = {
        method: "POST",
        uri: `${Conf.get(
          "MEXCHANGE_HOST",
          "https://dev.mexchange.vn",
        )}/api2/customer/create-merchant-customer`,
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${Conf.get(
            "MEXCHANGE_SECRET",
            "f7af4bc5-c32f-4e94-9426-f59acb31408c",
          )}`,
        },
        body: JSON.stringify({
          refId: customerInfo.phone,
          phone: customerInfo.phone,
        }),
      };
      // eslint-disable-next-line handle-callback-err
      const exchangeInfo = await request(options);
      await prismaClient.customer.update({
        where: {
          id: customerInfo.id,
        },
        data: {
          exchangeId: exchangeInfo.customerInfo.id,
        },
      });
    } catch (error) {
      throw ono("e_cannot_create_exchange_info");
    }
  },

  async getExchangeInfo(customerInfo: any) {
    try {
      const body: any = {};
      if (customerInfo.phone) {
        body.phone = customerInfo.phone;
      } else {
        body.customerId = customerInfo.exchangeId;
      }
      const options: RawAxiosRequestConfig = {
        method: "POST",
        url: `${Conf.get(
          "MEXCHANGE_HOST",
          "https://dev.mexchange.vn",
        )}/api2/customer/get-customer-info`,
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${Conf.get(
            "MEXCHANGE_SECRET",
            "f7af4bc5-c32f-4e94-9426-f59acb31408c",
          )}`,
        },
        data: body,
      };
      const exchangeInfo = await request(options);
      if (
        exchangeInfo.customerInfo.id === "" ||
        exchangeInfo.customerInfo.id !== customerInfo.exchangeId
      ) {
        await this.createExchangeInfo(customerInfo);
      }
      return exchangeInfo.customerInfo;
    } catch (error) {
      throw ono({
        code: "e_cannot_create_exchange_info",
      });
    }
  },

  async updateCustomerInfo(customerId: number, info: any) {
    const customerInfo: any = await this.getCustomerInfo(customerId);
    if (!customerInfo.inviteCode && !info.inviteCode) {
      info.inviteCode = await generateUniqueCustomerInviteCode(prismaClient);
    }
    for (const i in info) {
      customerInfo[i] = info[i];
    }
    const cachedCustomerInfo = { ...customerInfo };
    delete cachedCustomerInfo.totalConsumptionPoint;
    delete cachedCustomerInfo.totalCommissionAmount;
    redis.set(
      this.getCustomerKey(customerId),
      JSON.stringify(cachedCustomerInfo),
      "EX",
      Conf.get(`CACHE_TIME_LONG`, 86400),
    );
    try {
      await prismaClient.customer.update({
        where: {
          id: customerId,
        },
        data: info,
      });
    } catch (error) {
      /** */
    }

    return customerInfo;
  },

  async getCustomerInfo(customerId: number) {
    try {
      let customerInfo: any = null;
      const raw = await redis.get(this.getCustomerKey(customerId));
      if (raw) {
        customerInfo = JSON.parse(raw);
      } else {
        customerInfo = await prismaClient.customer.findUnique({
          where: {
            id: customerId,
          },
        });
        if (customerInfo) {
          await redis.set(
            this.getCustomerKey(customerInfo.id),
            JSON.stringify(customerInfo),
            "EX",
            300,
          );
        }
      }
      if (!customerInfo) {
        throw ono("e_cannot_find_customer_info");
      }
      // Cache chỉ lưu hồ sơ. Hai ví cùng đọc số khả dụng mới nhất mỗi lần,
      // kể cả khi đơn mua hàng đang giữ tiền hoặc vừa thanh toán xong.
      delete customerInfo.consumptionPointBalance;
      delete customerInfo.consumptionPointReserved;
      delete customerInfo.consumptionPointAvailable;
      const [pointBalance, commissionWalletAvailable] = await Promise.all([
        getConsumptionPointBalance(customerId),
        getCommissionWalletAvailable(customerId),
      ]);
      customerInfo.totalConsumptionPoint = pointBalance.available;
      customerInfo.totalCommissionAmount = Math.max(
        commissionWalletAvailable,
        0,
      );
      return customerInfo;
    } catch (error) {
      throw ono("e_cannot_find_customer_info");
    }
  },

  updateVersionCustomerProfile: async (phone: number, exchangeId: number) => {
    const version = await redis.set(
      `version_profile_customer_${phone || exchangeId}`,
      cryptUtils.uuid(),
    );
    return version;
  },

  getVersionCustomerProfile: async (phone: number, exchangeId: number) => {
    let version = await redis.get(
      `version_profile_customer_${phone || exchangeId}`,
    );
    if (!version) {
      version = await customerService.updateVersionCustomerProfile(
        phone,
        exchangeId,
      );
    }
    return version;
  },

  async getCustomerByPhone(phone: string) {
    let customerInfo = await prismaClient.customer.findFirst({
      where: {
        phone: phone,
      },
    });
    if (customerInfo) {
      return customerInfo;
    }
    const customerInfoCreate = { phone: phone };
    customerInfo = await this.createCustomer(customerInfoCreate);
    return customerInfo;
  },

  async getCustomerByRef(ref: string) {
    const customerInfo = await prismaClient.customer.findFirst({
      where: {
        merchantRef: ref,
      },
    });
    if (customerInfo) {
      return customerInfo;
    }
    return null;
  },

  async syncCustomer(merchantRef: string, name?: string) {
    try {
      let customerInfo = null;
      const vietnamesePhoneRegex = /^84[3-9]\d{8}$/;
      const updatedMerchantRef = merchantRef.replace(/^0/, "84");
      if (!vietnamesePhoneRegex.test(updatedMerchantRef)) {
        throw ono({
          code: "e_invalid_phone_number",
          message:
            "Invalid Vietnamese phone number. Must start with 84 followed by 9 digits.",
        });
      }
      const customerCache: string | null = await redis.get(
        this.getCustomerRef(updatedMerchantRef),
      );
      if (customerCache) {
        customerInfo = JSON.parse(customerCache);
      } else {
        customerInfo = await prismaClient.$transaction(
          async (tnx) => {
            let existCustomer = await tnx.customer.findFirst({
              where: { merchantRef: updatedMerchantRef },
            });
            if (!existCustomer) {
              existCustomer = await tnx.customer.create({
                data: {
                  merchantRef: updatedMerchantRef,
                  name: name || updatedMerchantRef,
                  phone: updatedMerchantRef,
                  inviteCode: await generateUniqueCustomerInviteCode(tnx),
                },
              });
            }
            return existCustomer;
          },
          {
            maxWait: 5000,
            timeout: 10000,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
        await redis.set(
          this.getCustomerRef(updatedMerchantRef),
          JSON.stringify(customerInfo),
          "EX",
          1800,
        );
        if (!customerInfo.exchangeId) {
          customerService.createExchangeInfo(customerInfo).then(() => {});
        }
      }
      const token = customerService.createToken(customerInfo.id);
      return token;
    } catch (error) {
      console.log(
        "🚀 ~ file: customer.service.ts:555 ~ syncCustomer ~ error:",
        error,
      );
      return null;
    }
  },

  verifyOtp: async (params: {
    keyRedis: string;
    keyPrivate: string;
    otp: string;
  }) => {
    const { keyRedis, keyPrivate, otp } = params;
    const redisOTP = await redis.get(keyRedis);
    if (redisOTP !== keyPrivate + otp) throw ono("invalid_otp");
    return true;
  },

  isDevMode: () => {
    return Conf.get("NODE_ENV", "development") === "development";
  },

  verifyPhoneWhiteList: async (phone: string, otp: string) => {
    if (customerService.isDevMode()) {
      const otpWhiteList = Conf.get("OTP_WHITE_LIST", "1234");
      if (String(otpWhiteList) !== String(otp)) throw ono("invalid_otp");
      return true;
    }
    const cachePhoneWhiteList = await Conf.get("PhoneWhiteList", "0981608298");
    if (cachePhoneWhiteList) {
      const phoneWhiteList = cachePhoneWhiteList
        .split(",")
        .map((e: string) => e.trim());
      if (phoneWhiteList.includes(phone)) {
        const otpWhiteList = Conf.get("OTP_WHITE_LIST");
        if (String(otpWhiteList) !== String(otp)) throw ono("invalid_otp");
        return true;
      }
      return false;
    }
    return false;
  },

  createOTP: async (key: string, keyPrivate: string) => {
    const isDev = customerService.isDevMode();
    const otpWhiteList = Conf.get("OTP_WHITE_LIST", "1234");
    const OTP = isDev ? String(otpWhiteList) : generateOTP();
    const time = Conf.get("OTP_TIME_EXPIRE", 60 * 4);
    await redis.set(key, keyPrivate + OTP, "EX", time);
    return OTP;
  },

  processOtpVerification: async (params: {
    emailOrPhone: string;
    keyPrivate: string;
    otp: string;
    typeVerify: string;
  }) => {
    const { emailOrPhone, keyPrivate, otp, typeVerify } = params;
    const { customer, type } =
      await customerService.getCustomerAndType(emailOrPhone);
    let keyRedis;
    switch (typeVerify) {
      case "register":
        keyRedis = emailOrPhone;
        if (customer) {
          throw ono("exists_account");
        }
        break;
      case "forget_password":
        keyRedis = `forgetPassword:${emailOrPhone}`;
        if (!customer) {
          throw ono("not_found_account");
        }
        break;
      default:
        throw ono("invalid_type_verify");
    }
    if (customerService.isDevMode()) {
      const otpWhiteList = Conf.get("OTP_WHITE_LIST", "1234");
      if (String(otpWhiteList) !== String(otp)) throw ono("invalid_otp");
      return {
        customer: customer,
        response: type,
      };
    }
    if (type === "phone") {
      if (await customerService.verifyPhoneWhiteList(emailOrPhone, otp)) {
        return {
          customer: customer,
          response: type,
        };
      }
    }
    await customerService.verifyOtp({
      keyRedis,
      keyPrivate,
      otp,
    });
    return {
      customer: customer,
      response: type,
    };
  },

  validateAndSendOtp: async (params: {
    emailOrPhone: string;
    typeSendOtp: "register" | "forget_password";
    keyPrivate: string;
    key: string;
  }) => {
    const { emailOrPhone, typeSendOtp, keyPrivate, key } = params;
    const { customer, type } =
      await customerService.getCustomerAndType(emailOrPhone);
    switch (typeSendOtp) {
      case "register":
        if (customer) {
          throw ono("exists_account");
        }
        break;
      case "forget_password":
        if (!customer) {
          throw ono("not_found_account");
        }
        // if (customer.secure === null) {
        //   throw ono("account_not_has_password");
        // }
        break;
      default:
        throw ono("invalid_type_send_otp");
    }

    await customerService.sendOTP({
      emailOrPhone,
      type,
      keyPrivate,
      key,
      typeSendOtp,
    });

    return type;
  },

  getCustomerByMerchantRef: async (emailOrPhone: string) => {
    const phoneVariants = isPhone(emailOrPhone)
      ? [
          emailOrPhone,
          emailOrPhone.startsWith("84")
            ? `0${emailOrPhone.slice(2)}`
            : `84${emailOrPhone.slice(1)}`,
        ]
      : [];

    // Email/phone là định danh đăng nhập hiện tại. merchantRef chỉ là fallback
    // cho các tài khoản cũ, tránh chọn nhầm khi giá trị này thuộc user khác.
    const customer = await prismaClient.customer.findFirst({
      where: {
        OR: [
          { email: emailOrPhone },
          {
            phone: {
              in: phoneVariants.length ? phoneVariants : [emailOrPhone],
            },
          },
        ],
      },
    });
    if (customer) return customer;

    return prismaClient.customer.findFirst({
      where: {
        merchantRef: {
          in: phoneVariants.length ? phoneVariants : [emailOrPhone],
        },
      },
    });
  },

  getCustomerAndType: async (emailOrPhone: string) => {
    const customer =
      await customerService.getCustomerByMerchantRef(emailOrPhone);
    const type = customerService.determineEmailOrPhone(emailOrPhone);
    return {
      customer: customer,
      type: type,
    };
  },

  updatePhonePrefixFrom84To0: async () => {
    try {
      const customerBy84 = await prismaClient.customer.findMany({
        where: {
          phone: {
            startsWith: "84",
          },
        },
      });

      if (customerBy84.length === 0) return;
      if (customerBy84.length > 0) {
        for (const customer of customerBy84) {
          if (customer?.phone) {
            const phone = customer.phone.replace(/^84/, "0");
            await prismaClient.customer.update({
              where: { id: customer.id },
              data: { phone: phone },
            });
          }
        }
      }
      return true;
    } catch (error) {
      console.log(
        "🚀 ~ file: customer.service.ts:628 ~ updatePhonePrefixFrom84To0: ~ error",
        error,
      );
      return false;
    }
  },

  determineEmailOrPhone: (emailOrPhone: string) => {
    switch (true) {
      case isEmail(emailOrPhone):
        return "email";
      case isPhone(emailOrPhone):
        return "phone";
      default:
        throw ono("invalid_email_or_phone");
    }
  },

  sendOTP: async (params: {
    emailOrPhone: string;
    type: string;
    keyPrivate: string;
    key: string;
    typeSendOtp: "register" | "forget_password";
  }) => {
    const { emailOrPhone, type, keyPrivate, key, typeSendOtp } = params;
    const OTP = await customerService.createOTP(key, keyPrivate);
    switch (type) {
      case "email":
        if (customerService.isDevMode()) {
          console.log(`\n🔥 [DEV] OTP cho ${emailOrPhone}: ${OTP}\n`);
          break;
        }
        const emailRequestKey = `otp_email_request_id:${emailOrPhone}_${typeSendOtp}`;
        if (await redis.get(emailRequestKey)) {
          const ttl = await redis.ttl(emailRequestKey);
          throw ono({ message: "limit_send_otp_request_id", ttl });
        }
        const emailLog = await prismaClient.otpLog.create({
          data: {
            phone: emailOrPhone,
            otp: OTP,
            type: typeSendOtp,
          },
        });
        try {
          const response = await customerService.sendOtpEmail({
            email: emailOrPhone,
            subject: "Nacare mã xác nhận",
            OTP,
          });
          await prismaClient.otpLog.update({
            where: { id: emailLog.id },
            data: {
              messageBody: JSON.stringify(response),
              status: "sent",
            },
          });
          const time = Conf.get("OTP_TIME_EXPIRE_SET_CACHE", 60 * 3);
          await redis.set(emailRequestKey, "ok", "EX", Number(time));
        } catch (error: any) {
          await prismaClient.otpLog.update({
            where: { id: emailLog.id },
            data: {
              messageErr: `Lỗi gửi OTP: ${error.message || "Không xác định"}`,
              status: "error",
            },
          });
          throw ono("error_send_otp");
        }
        break;
      case "phone":
        if (customerService.isDevMode()) {
          console.log(`\n🔥 [DEV] OTP cho ${emailOrPhone}: ${OTP}\n`);
          break;
        }
        const phoneWhiteList = await Conf.get("PhoneWhiteList", "0981608298");
        if (phoneWhiteList) {
          const PhoneWhiteList = phoneWhiteList
            .split(",")
            .map((e: string) => e.trim());
          if (PhoneWhiteList.includes(emailOrPhone)) break;
        }
        const key = `otp_sms_request_id:${emailOrPhone}_${typeSendOtp}`;
        const existsRequestId = await redis.get(key);
        if (existsRequestId) {
          const ttl = await redis.ttl(key);
          throw ono({
            message: "limit_send_otp_request_id",
            ttl,
          });
        }
        const prepareLogOtp: Prisma.otpLogCreateInput = {
          phone: emailOrPhone,
          otp: OTP,
          type: typeSendOtp,
        };
        const logOtp = await prismaClient.otpLog.create({
          data: prepareLogOtp,
        });
        try {
          // const res = await gapitManager
          //   .getInstance()
          //   .sendOTP(OTP, emailOrPhone);
          const res = await customerService.sendSMS({
            phone: emailOrPhone,
            sms: `Ma OTP la ${OTP}. Ma OTP chi su dung cho 1 lan dang nhap ung dung mPoint`,
          });
          const updateLogOtp: Prisma.otpLogUpdateInput = {
            messageBody: JSON.stringify(res),
            status: "sent",
          };
          await prismaClient.otpLog.update({
            where: { id: logOtp.id },
            data: updateLogOtp,
          });
          const time = Conf.get("OTP_TIME_EXPIRE_SET_CACHE", 60 * 3);
          await redis.set(key, "ok", "EX", Number(time));
        } catch (error: any) {
          console.log("🚀 ~ error:", error);
          const updateLogOtp: Prisma.otpLogUpdateInput = {
            messageErr: `Lỗi gửi OTP: ${error.message || "Không xác định"}`,
            status: "error",
          };
          await prismaClient.otpLog.update({
            where: { id: logOtp.id },
            data: updateLogOtp,
          });
          throw ono("error_send_otp");
        }
        break;
      default:
        throw ono("invalid_email_or_phone");
    }
  },

  sendSMS: async (otpInfo: any) => {
    if (customerService.isDevMode()) {
      return true;
    }
    const options: RawAxiosRequestConfig = {
      method: "POST",
      url: `${Conf.get(
        "OTP_URI",
        "https://app.mexchange.vn/api2/notification/push-sms",
      )}`,
      headers: {
        "content-type": "application/json",
        authorization:
          "Basic " +
          Conf.get("OTP_TOKEN", "ba6d1f90-a35b-4040-8a1c-cf53e071b4c2"),
      },
      data: JSON.stringify({
        phone: otpInfo.phone,
        body: otpInfo.sms,
        secret: Conf.get("OTP_SECRET", "2b4c9a82-6506-4960-ada6-1665ff38a539"),
      }),
      timeout: 5000,
    };
    await request(options);
    return;
  },

  sendOtpEmail: async (params: {
    email: string;
    subject: string;
    OTP: string;
  }) => {
    const { email, subject, OTP } = params;
    const token = Conf.get("OTP_TOKEN", "ba6d1f90-a35b-4040-8a1c-cf53e071b4c2");
    const template = await getCompiledTemplate("tmp_sendOtp");
    const options: RawAxiosRequestConfig = {
      method: "PUT",
      url: Conf.get(
        "OTP_EMAIL_URI",
        "https://app.mexchange.vn/api2/notification/emails",
      ),
      data: {
        to: [email],
        subject,
        body: template({ receiveEmail: email, OTP }),
        app:
          process.env.OTP_EMAIL_APP ||
          Conf.get("OTP_EMAIL_APP", "app.mail1.no-reply"),
      },
      headers: {
        Authorization: `Basic ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 5000,
    };
    return request(options);
  },
};
export default customerService;
