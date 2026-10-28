import customerMiddleware from "@root/src/middleware/customer";
import customerService from "@root/src/services/customer.service";
import { SENDER_TYPE } from "@root/src/types/chat.type";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
// import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: `/generate-token-chat`,
    preHandler: [customerMiddleware as any],
    // Define your schema
    schema: {
      tags: ["customer"],
      description: "Tạo token chat",
      summary: "Tạo token chat",
      // body: z.object({
      // }),
      // querystring: z.object({
      // }),
      response: {},
    },
    handler: async (req, res) => {
      try {
        // @ts-ignore
        const customerId = req.customerId;
        const token = customerService.createTokenChat(
          customerId,
          SENDER_TYPE.USER
        );
        return res.status(200).send({
          code: 0,
          message: "Tạo token chat thành công",
          data: { token },
        });
      } catch (err) {
        console.log(err);
        return res.status(500).send({
          code: 1,
          message: "Đã có lỗi xảy ra, vui lòng thử lại sau",
          error: err,
        });
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
