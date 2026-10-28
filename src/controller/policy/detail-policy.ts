import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { policyService } from "@root/src/services/policy.service";
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/detail-policy`,
    schema: {
      tags: ['Policy'],
      summary: 'Policy - Detail',
      description: 'Chi tiết chính sách',
      querystring: z.object({
        id: z.string().
        transform(val => Number(val) > 0 ? Number(val) : 0)
      }),
    },
    handler: async (req: any, res) => {
      const { id } = req.query
      try {
        const policy = await policyService.getPolicyDetail(id)
        if (!policy) {
          return res.status(404).send({ message: 'Chính sách không tồn tại' })
        }
        return res.send({
          code: 0,
          message: 'Thành công',
          data: policy,
        })
      } catch (error) {
        return res.status(500).send({ message: 'Lỗi khi lấy chính sách' })
      }
    },
  });
};