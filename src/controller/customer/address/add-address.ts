import customerMiddleware from "@root/src/middleware/customer";
import addressService from "@root/src/services/address.service";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/add-address`,
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ['Customer'],
      summary: 'Add address',
      description: 'Add address',
      body: z.object({
        address: z.string(),
        name: z.string(),
        phone: z.string(),
        wardId: z.number(),
        districtId: z.number().optional(),
        provinceId: z.number(),
        note: z.string().optional(),
        isDefault: z.boolean().optional(),
        type: z.enum(['home', 'work', 'other']).optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const customerId = req.customerId;
        const { address, name, phone, wardId, districtId, provinceId, isDefault, type, note, latitude, longitude } = req.body;

        const addressData = {
          address,
          name,
          phone,
          wardId,
          districtId: districtId ?? null,
          provinceId,
          isDefault,
          type,
          customerId,
          note,
          latitude,
          longitude,
        };

        const updatedAddresses = await addressService.updateAddress(customerId, addressData, 'create');

        return res.status(200).send({
          code: 0,
          message: "Thêm địa chỉ thành công!",
          data: updatedAddresses[updatedAddresses.length - 1],
        });
      } catch (error) {
        console.error(error);
        return res.status(500).send({
          code: -1,
          message: "Hệ thống bận xin vui lòng thử lại!",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
