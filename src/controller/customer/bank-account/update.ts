import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import customerMiddleware from "@root/src/middleware/customer";
import {
  bankAccountParams,
  bankFields,
  customerIdFromRequest,
  publicBankAccount,
  sendBankAccountFailure,
} from "@root/src/helpers/customerBankAccount.helper";
import customerBankAccountService from "@root/src/services/customerBankAccount.service";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "PUT",
    url: "/:bankAccountId",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Sửa tài khoản ngân hàng",
      params: bankAccountParams,
      body: bankFields
        .partial()
        .refine(
          (value) => Object.keys(value).length > 0,
          "Cần cung cấp ít nhất một trường để cập nhật",
        ),
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = customerIdFromRequest(req);
      if (!customerId)
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      try {
        const account = await customerBankAccountService.update(
          customerId,
          req.params.bankAccountId,
          req.body,
        );
        if (!account)
          return res
            .code(404)
            .send({ code: 1, message: "Không tìm thấy tài khoản ngân hàng" });
        return res.send({
          code: 0,
          message: "Đã cập nhật tài khoản ngân hàng",
          data: publicBankAccount(account),
        });
      } catch (error) {
        return sendBankAccountFailure(req, res, error);
      }
    },
  });
};
