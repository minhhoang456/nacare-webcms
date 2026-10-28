import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import customerMiddleware from "@root/src/middleware/customer";
import {
  customerIdFromRequest,
  publicBankAccount,
  sendBankAccountFailure,
} from "@root/src/helpers/customerBankAccount.helper";
import customerBankAccountService from "@root/src/services/customerBankAccount.service";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: "/",
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      summary: "Danh sách tài khoản ngân hàng đã lưu",
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = customerIdFromRequest(req);
      if (!customerId)
        return res.code(401).send({ code: 1, message: "Lỗi xác thực" });
      try {
        const items = await customerBankAccountService.list(customerId);
        return res.send({
          code: 0,
          message: "Thành công",
          data: items.map(publicBankAccount),
        });
      } catch (error) {
        return sendBankAccountFailure(req, res, error);
      }
    },
  });
};
