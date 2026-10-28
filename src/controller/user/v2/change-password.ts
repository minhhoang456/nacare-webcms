import ono from '@jsdevtools/ono'
import userMidlleware from '@root/src/middleware/user'
import cryptUtils from '@src/utils/crypt'
import { prismaClient } from '@src/utils/prisma'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import moment from 'moment'
import { z } from 'zod'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'PATCH',
    url: `/change-password`,
    preHandler: [userMidlleware as any],
    // Define your schema
    schema: {
      body: z.object({
        newPassword: z.string().min(1),
        confirmPassword: z.string().min(1),
        oldPassword: z.string().min(1)
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req: any, res) => {
      try {
        const { oldPassword, newPassword, confirmPassword } = req.body
        const userInfo = await prismaClient.user.findUnique({
          where: {
            id: req.userId
          }
        })
        if (!userInfo?.password) {
          throw ono('e_not_found_password')
        }
        const isMatch = await cryptUtils.checkHash(
          oldPassword,
          userInfo.password
        )
        if (!isMatch) throw ono('e_invalid_old_password')

        if (newPassword !== confirmPassword)
          throw ono('e_password_does_not_match')

        const hashPassNew = (await cryptUtils.hash(newPassword)) as string
        await prismaClient.user.update({
          where: {
            id: userInfo.id
          },
          data: {
            password: hashPassNew,
            changePasswordAt: moment().valueOf()
          }
        })
        return res.send({ code: 0, message: 'Thay đổi mật khẩu thành công' })
      } catch (err: any) {
        switch (err.message) {
          case 'e_invalid_old_password':
            return { code: 2, message: 'Mật khẩu cũ không đúng' }
          case 'e_password_does_not_match':
            return { code: 3, message: 'Mật khẩu không khớp' }
          default:
            return { code: -1, message: 'Lỗi hệ thống', err }
        }
      }
    }
  })
}
