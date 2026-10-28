import { popupServiceService } from '@root/src/services'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
// import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-popup`,
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
        const popup = await popupServiceService.getActivePopup()
        if (popup) {
          return res.send({ code: 0, message: 'Thành công', data: popup })
        }
        return res.send({ code: 0, message: 'Thành công', data: null })
      } catch (error) {
        return res.send({
          code: 1,
          message: 'Hệ thống bận, vui lòng thử lại sau ít phút.'
        })
      }
    }
  })
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
