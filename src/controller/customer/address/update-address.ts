import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import customerMiddleware from "@root/src/middleware/customer";
import { z } from "zod";
import { addressService } from "@root/src/services";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "PUT",
    url: `/update-address`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ['Customer'],
      summary: 'Update address',
      description: 'Update address',
      body: z.object({
        address: z.string().optional(),
        name: z.string().optional(),
        phone: z.string().optional(),
        wardId: z.number().nullable().optional(),
        districtId: z.number().nullable().optional(),
        provinceId: z.number().nullable().optional(),
        note: z.string().optional(),
        isDefault: z.boolean().optional(),
        type: z.enum(['home', 'work', 'other']).optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      }),
      querystring: z.object({
        addressId: z.number().or(z.string().regex(/\d+/).transform(Number)).refine((n) => n >= 0),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const customerId = req.customerId;
        const { addressId } = req.query;
        const updateData = { ...req.body };
        if (updateData.provinceId !== undefined && updateData.wardId !== undefined && updateData.districtId === undefined) {
          updateData.districtId = null;
        }

        const addressData = {
          id: addressId,
          ...updateData,
          customerId,
        };

        const updatedAddresses = await addressService.updateAddress(customerId, addressData, 'update');
        const updatedAddress = updatedAddresses.find((addr: any) => addr.id === addressId);

        if (!updatedAddress) {
          return res.status(404).send({
            code: 1,
            message: "Địa chỉ không tìm thấy!",
          });
        }

        return res.status(200).send({
          code: 0,
          message: "Cập nhật địa chỉ thành công!",
          data: updatedAddress,
        });
      } catch (error) {
        console.error(error);
        return res.status(500).send({
          code: -1,
          message: "Hệ thống bận!",
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
