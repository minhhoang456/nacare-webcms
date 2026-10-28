import ono from "@jsdevtools/ono";
import customerMiddleware from "@root/src/middleware/customer";
import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { customerService } from "@root/src/services";
import { isPhone } from "@root/src/helpers/func.helper";
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "PUT",
    url: `/update-customer`,
    // Define your schema
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ['Customer'],
      description: 'Cập nhật thông tin khách hàng',
      body: z.object({
        name: z.string(),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        address: z.string().optional(),
        birth: z.number().optional(),
        gender: z.enum(['male', 'female']).optional(),
        avatar: z.string().optional(),
        provinceId: z.number().nullable().optional(),
        districtId: z.number().nullable().optional(),
        wardId: z.number().nullable().optional(),
        cccd: z.string().max(20).optional(),
        cccdFrontImage: z.string().max(255).optional(),
        cccdBackImage: z.string().max(255).optional(),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        //@ts-ignore
        const customerId = req.customerId;
        let { phone, email, provinceId, wardId, districtId } = req.body;

        let phoneConvert;
        let dataUpdate = { ...req.body };
        if (provinceId !== undefined && wardId !== undefined && districtId === undefined) {
          dataUpdate.districtId = null;
        }
        if (phone) {
          if (!isPhone(phone)) throw ono('e_invalid_phone_number');
          phoneConvert = phone.startsWith('84') ? '0' + phone.slice(2) : phone;
          dataUpdate.phone = phoneConvert;
        }

        await Promise.all([
          customerService.getCustomerInfo(customerId),
          checkUniqueCustomer({ customerId, phone: phoneConvert, email }),
        ]);

        const customer = await customerService.updateCustomerInfo(customerId, dataUpdate);

        return res.status(200).send({
          code: 0,
          message: "Success",
          data: customer,
        });
      } catch (error: any) {
        return res.status(500).send({
          code: -1,
          message: msg[error.message] || 'Hệ thống bận',
        });
      }
    },
  });
};

const checkUniqueCustomer = async (params: {
  customerId: number,
  phone?: string,
  email?: string,
}): Promise<Boolean> => {
  const { customerId, phone, email } = params;
  if (!phone && !email) return true;

  const checkUnique = await prismaClient.customer.findFirst({
    where: {
      OR: [{ phone }, { email }],
      id: { not: customerId },
    },
  });

  if (checkUnique) throw ono('e_unique_phone_email');
  return true;
};

const msg: any = {
  e_cannot_find_customer_info: 'Khách hàng không tồn tại',
  e_unique_phone_email: 'Số điện thoại hoặc email đã tồn tại vui lòng chọn số điện thoại hoặc email khác',
  e_invalid_phone_number: 'Số điện thoại không hợp lệ',
}