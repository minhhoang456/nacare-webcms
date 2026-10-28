import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { prismaClient } from '@root/src/utils/prisma'
// import { z } from "zod";
import userMidlleware from '@src/middleware/user'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/get-meta`,
    preHandler: [userMidlleware as any],
    // Define your schema
    schema: {
      // body:{},
      // querystring: {},
      // response: {},
    },
    handler: async (_req, res) => {
      const pages = await prismaClient.page.findMany(),
        menus = await prismaClient.menu.findMany({
          where: {
            isActive: true
          },
          orderBy: {
            sequence: 'desc'
          }
        })
      return res.send({ pages, menus })
    }
  })
}
