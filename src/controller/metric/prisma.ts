import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
// import { z } from "zod";
import { prismaClient } from '@root/src/utils/prisma'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/prisma`,
    // Define your schema
    schema: {
      // body: z.object({
      // }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (_req, res) => {
      try {
        //@ts-ignore
        const metrics = await prismaClient.$metrics.prometheus()
        res.send(metrics)
      } catch (err) {
        console.log(err)
        res.status(500).send({ error: 'Internal Server Error' })
      }
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
