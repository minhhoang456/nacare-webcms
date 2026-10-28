import customerMiddleware from "@root/src/middleware/customer";
import { addressService } from "@root/src/services";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
// import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-list-address-by-customer`,
    preHandler: [customerMiddleware as any],

    // Define your schema
    schema: {
      tags: ['Customer'],
      summary: 'Get list of addresses by customer',
      description: 'Get list of addresses by customer',
      // body: z.object({
      // }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req:any, res) => {try {
      const customerId = req.customerId;
      const addresses = await addressService.getAddressesByCustomerId(customerId);

      return res.status(200).send({
        code: 0,
        message: "Lấy danh sách địa chỉ thành công!",
        data: addresses,
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
