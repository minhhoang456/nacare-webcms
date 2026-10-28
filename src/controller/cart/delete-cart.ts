import customerMiddleware from "@root/src/middleware/customer";
import redis from "@root/src/utils/redis";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "delete",
    url: `/delete-cart`,
    preHandler: [customerMiddleware as any],
    schema: {
      tags: ['Cart'],
      description: 'Xóa giỏ hàng',
      response: {},
    },
    handler: async (req: any, res) => {
      const customerId = req.customerId;
      try {
        await redis.del(`cart:${customerId}`);
        return res.status(200).send({
          message: "Cart deleted successfully",
          code: 0
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
  e_not_valid_request: 'Vui lòng gửi đúng thông tin',
}
// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),