import customerMiddleware from "@root/src/middleware/customer";
import { addressService } from "@root/src/services";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/delete`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["Customer"],
      summary: "Xóa địa chỉ",
      description: "Xóa địa chỉ",
      // body: z.object({
      // }),
      querystring: z.object({
        addressId: z.number().or(z.string().regex(/\d+/).transform(Number)).refine((n) => n >= 0),
      }),
      response: {},
    },
    handler: async (req: any, res) => {
      try {
        const { addressId } = req.query;
        const customerId = req.customerId;

        const findAddress = await addressService.getAddressesByCustomerId(customerId);
        const address = findAddress.find((addr: any) => addr.id === addressId);

        if (!address) {
          return res.status(404).send({
            code: 1,
            message: "Địa chỉ không tồn tại!",
          });
        }

        await addressService.updateAddress(customerId, { id: addressId }, 'delete');

        return res.status(200).send({
          code: 0,
          message: "Xóa địa chỉ thành công!",
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
