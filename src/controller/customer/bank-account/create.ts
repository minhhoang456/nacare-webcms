import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import customerMiddleware from "@root/src/middleware/customer";
import {
  bankFields,
  customerIdFromRequest,
  publicBankAccount,
  sendBankAccountFailure,
} from "@root/src/helpers/customerBankAccount.helper";
import customerBankAccountService from "@root/src/services/customerBankAccount.service";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Lưu tài khoản ngân hàng",
      body: bankFields.extend({ isDefault: z.boolean().optional() }),
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = customerIdFromRequest(req);
      if (!customerId)
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      try {
        const account = await customerBankAccountService.create(
          customerId,
          req.body,
        );
        if (!account)
          return res.code(422).send({
            code: 1,
            message: "Chỉ được lưu tối đa 5 tài khoản ngân hàng",
          });
        return res.code(201).send({
          code: 0,
          message: "Đã thêm tài khoản ngân hàng",
          data: publicBankAccount(account),
        });
      } catch (error) {
        return sendBankAccountFailure(req, res, error);
      }
    },
  });
};
