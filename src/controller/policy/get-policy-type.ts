import { policyService } from "@root/src/services/policy.service";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/get-policy-type`,
    // Define your schema
    schema: {
      response: {},
    },
    handler: async (_req, res) => {
      try {
        const result = await policyService.getPolicyType()
        return res.send({
          code: 0,
          message: 'Thành công',
          data: result,
        })
      } catch (error) {
        return res.status(500).send({
          code: 1,
          message: 'Hệ thống bận',
        })
      }
    },
  });
};

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
