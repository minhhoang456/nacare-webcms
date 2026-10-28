import ono from "@jsdevtools/ono";
import customerMiddleware from "@root/src/middleware/customer";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import bcrypt from "bcrypt";
import crypt from "@root/src/utils/crypt";
import { customerService } from "@root/src/services";
import { prismaClient } from "@root/src/utils/prisma";
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "PUT",
    url: `/update-password`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ["Customer"],
      description: "Cập nhật mật khẩu khách hàng",
      body: z.object({
        password: z.string(),
        newPassword: z.string(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        //@ts-ignore
        const customerId = req.customerId;
        const { password, newPassword } = req.body;
        const checkCustomer = await getCustomerInfo(customerId);
        if (!checkCustomer) throw ono("e_cannot_find_customer_info");
        await isPasswordMatch(password, checkCustomer);
        await isPasswordNew(newPassword, checkCustomer);
        const newPasswordHash = await createPasswordHash(newPassword);
        const customer = await customerService.updateCustomerInfo(customerId, {
          secure: String(newPasswordHash),
        });
        delete customer.secure;
        return res.status(200).send({
          code: 0,
          message: "Success",
          data: customer,
        });
      } catch (error: any) {
        return res.status(404).send({
          code: -1,
          message: msg[error.message] || "Hệ thống bận",
        });
      }
    },
  });
};

const msg: any = {
  e_cannot_find_customer_info: "Tài khoản không tồn tại , vui lòng thử lại",
  e_password_not_match: "Mật khẩu không đúng, vui lòng thử lại",
  e_password_not_match_new:
    "Mật khẩu mới không được giống mật khẩu cũ, vui lòng thử lại",
};

async function isPasswordMatch(password: string, customer: any) {
  if (!(await bcrypt.compare(password, customer.secure)))
    throw ono("e_password_not_match");
}

async function isPasswordNew(password: string, customer: any) {
  if (await bcrypt.compare(password, customer.secure))
    throw ono("e_password_not_match_new");
}

async function createPasswordHash(password: string) {
  return await crypt.hash(password);
}

async function getCustomerInfo(customerId: number) {
  return await prismaClient.customer.findUnique({
    where: { id: customerId },
    select: { secure: true },
  });
}
