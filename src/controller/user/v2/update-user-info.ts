import { prismaClient } from '@src/utils/prisma'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import commonUtils from '@src/utils/common'
import ono from '@jsdevtools/ono'
import userMidlleware from '@root/src/middleware/user'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'PATCH',
    url: `/update-user-info`,
    preHandler: [userMidlleware as any],
    // Define your schema
    schema: {
      body: z.object({
        avatar: z.string().optional(),
        email: z.string().optional(),
        name: z.string(),
        phone: z.string().optional()
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req: any, res) => {
      try {
        const { phone, email, avatar, name } = req.body
        const userId = req.user.id
        const userInfo = await prismaClient.user.findUnique({
          where: {
            id: userId
          }
        })
        if (!userInfo) {
          throw ono('e_not_found_user')
        }
        const phoneRegex = commonUtils.checkPhone(phone)
        if (!phoneRegex) {
          throw ono('e_phone_not_match')
        }
        await prismaClient.user.update({
          where: {
            id: userInfo.id
          },
          data: {
            phone: phone,
            email: email,
            avatar: avatar,
            name: name
          }
        })

        return res.send({
          code: 0,
          message: 'Cập nhật thông tin thành công'
        })
      } catch (err: any) {
        switch (err.message) {
          case 'e_phone_not_match':
            return {
              code: 2,
              message: 'Số điện thoại không hợp lệ! Vui lòng thử lại.'
            }
          default:
            return { code: -1, message: 'Lỗi hệ thống', err }
        }
      }
    }
  })
}
