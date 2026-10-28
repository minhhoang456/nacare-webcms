import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prismaClient } from "@root/src/utils/prisma";
import ono from "@jsdevtools/ono";
import redis from "@root/src/utils/redis";
import customerService from "@root/src/services/customer.service";
import crypt from "@root/src/utils/crypt";
import { generateUniqueCustomerInviteCode } from "@root/src/helpers/inviteCode.helper";
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/create-account`,
    schema: {
      tags: ["Customer"],
      summary: "Customer - Tạo tài khoản khách hàng",
      description: "Create customer account",
      body: z.object({
        emailOrPhone: z.string(),
        otp: z.string(),
        keyPrivate: z.string(),
        password: z.string(),
        inviteCode: z.string().trim().min(1).optional(),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      const { emailOrPhone, otp, keyPrivate, password, inviteCode } = req.body;
      let dataCustomer: any = {};
      try {
        const { response } = await customerService.processOtpVerification({
          emailOrPhone: emailOrPhone,
          typeVerify: "register",
          keyPrivate,
          otp,
        });
        switch (response) {
          case "email":
            dataCustomer = { email: emailOrPhone };
            break;
          case "phone":
            dataCustomer = {
              phone: emailOrPhone.startsWith("84")
                ? "0" + emailOrPhone.slice(2)
                : emailOrPhone,
            };
            break;
          default:
            throw ono("invalid_type");
        }
        const data = await createCustomer({
          emailOrPhone,
          password,
          dataCustomer,
          inviteCode,
        });
        return res.status(200).send({
          code: 0,
          message: `Tạo tài khoản thành công!`,
          token: data.tokenAccess,
        });
      } catch (error: any) {
        console.log("🚀 ~ handler: ~ error:", error);
        return res.status(500).send({
          code: -1,
          message: msgError[error.message] || "Lỗi hệ thống",
        });
      }
    },
  });
};

async function createCustomer(params: {
  emailOrPhone: string;
  password: string;
  dataCustomer: any;
  inviteCode?: string;
}) {
  const { emailOrPhone, password, dataCustomer, inviteCode } = params;
  const hashPassword: any = await crypt.hash(password);
  // Cây giới thiệu: tạo customer và cạnh cha-con trong cùng transaction để
  // không có tài khoản được tạo thành công nhưng mất mã người giới thiệu.
  const customer = await prismaClient.$transaction(async (tx) => {
    let referrer: {
      id: number;
      inviteCode: string | null;
    } | null = null;
    if (inviteCode) {
      referrer = await tx.customer.findUnique({
        where: { inviteCode },
        select: { id: true, inviteCode: true },
      });
      if (!referrer) throw ono("e_referrer_not_found");
    }
    const customerInviteCode = await generateUniqueCustomerInviteCode(tx);
    const created = await tx.customer.create({
      data: {
        ...dataCustomer,
        name: emailOrPhone,
        secure: hashPassword,
        merchantRef: emailOrPhone,
        inviteCode: customerInviteCode,
      },
    });
    if (referrer) {
      await tx.referral.create({
        data: {
          referrerCustomerId: referrer.id,
          referredCustomerId: created.id,
          inviteCode: (referrer.inviteCode || inviteCode)!,
        },
      });
    }
    return created;
  });

  if (!customer) throw ono("e_create_customer");

  const [tokenAccess] = await Promise.all([
    customerService.createToken(customer.id),
    redis.del(emailOrPhone),
  ]);
  return { customer, tokenAccess };
}

const msgError: any = {
  e_create_customer:
    "Lỗi tạo tài khoản khách hàng , vui lòng thử lại sau vài phút",
  invalid_type: "Email hoặc số điện thoại không đúng định dạng",
  invalid_otp: "Mã OTP không chính xác vui lòng thử lại",
  exists_account: "Email hoặc số điện thoại đã được sử dụng , vui lòng thử lại",
  password_length_invalid: "Mật khẩu phải có ít nhất 8 ký tự",
  e_referrer_not_found: "Mã người giới thiệu không tồn tại",
  invalid_email_or_phone: "Email hoặc số điện thoại không đúng định dạng",
};
