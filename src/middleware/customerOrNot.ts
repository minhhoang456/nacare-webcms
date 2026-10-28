import { FastifyReply, FastifyRequest } from "fastify";
import CustomerService from "@src/services/customer.service";

export default async function customerOrNotMiddleware(
  req: FastifyRequest & { customerId: number },
  res: FastifyReply
) {
  try {
    if (req.headers.authorization) {
      const token = req.headers.authorization.split(" ")[1];
      if (token) {
        const tokenInfo = await CustomerService.verifyCustomerToken(token);
        req.customerId = tokenInfo.customerId;
      }
    }
  } catch (error) {
    return res.code(403).send({
      code: 1,
      message: "Lỗi xác thực",
    });
  }
}
