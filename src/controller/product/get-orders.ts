import customerMiddleware from "@root/src/middleware/customer";
import { orderShipService } from "@root/src/services";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/get-orders`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["Product-Order"],
      body: z.object({
        skip: z.number().default(0),
        limit: z.number().default(10),
        status: z
          .enum([
            "wait_for_confirmation",
            "wait_for_pickup",
            "shipping",
            "canceled",
            "completed",
            "returnOrder",
          ])
          .optional()
          .describe("Trạng thái đơn hàng"),
        all: z
          .boolean()
          .default(false)
          .describe("Cho phép lấy tất cả đơn hàng"),
        storeId: z.number().optional().describe("Id của cửa hàng"),
      }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      //@ts-ignore
      const { customerId } = req;
      const { skip, limit, status, all, storeId } = req.body;
      let data: any = [];
      try {
        if (all) {
          data = await orderShipService.getListOrderShipsByAll(
            customerId,
            skip,
            limit,
            storeId
          );
        } else {
          // let statusCustom = '';
          // if (status == 'pending')
          //   statusCustom = `pending,wait_for_confirmation`;
          // if (status == 'cancel') statusCustom = `cancel,canceled`;
          data = await orderShipService.getListOrderShipsByCustomer({
            customerId,
            skip,
            limit,
            status: status,
          });
        }
        return res.send({
          code: 0,
          data: data[0],
          total: data[1],
          message: "Success",
        });
      } catch (error) {
        console.log("🚀 ~ file: get-orders ~ handler: ~ error:", error);
        return res
          .code(400)
          .send({ code: 1, data: [], total: 0, message: "Fail" });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
