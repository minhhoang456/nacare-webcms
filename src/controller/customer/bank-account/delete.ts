import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import customerMiddleware from "@root/src/middleware/customer";
import {
  bankAccountParams,
  customerIdFromRequest,
  sendBankAccountFailure,
} from "@root/src/helpers/customerBankAccount.helper";
import customerBankAccountService from "@root/src/services/customerBankAccount.service";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "DELETE",
    url: "/:bankAccountId",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Xóa tài khoản ngân hàng đã lưu",
      params: bankAccountParams,
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = customerIdFromRequest(req);
      if (!customerId)
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      try {
        const removed = await customerBankAccountService.remove(
          customerId,
          req.params.bankAccountId,
        );
        if (!removed)
          return res
            .code(404)
            .send({ code: 1, message: "Không tìm thấy tài khoản ngân hàng" });
        return res.send({ code: 0, message: "Đã xóa tài khoản ngân hàng" });
      } catch (error) {
        return sendBankAccountFailure(req, res, error);
      }
    },
  });
};
