import cryptUtils from '@src/utils/crypt'
import { prismaClient } from '@src/utils/prisma'
import pageMiddleware from '@src/middleware/page'
import userMidlleware from '@root/src/middleware/user'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import actionLogMidlleware from '@root/src/middleware/actionLog'
import redis from '@root/src/utils/redis'
import ono from '@jsdevtools/ono'
import moment from 'moment'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/change-password`,
    preHandler: [userMidlleware as any, pageMiddleware, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        newPassword: z.string().min(1),
        confirmPassword: z.string().min(1),
        captcha: z.string().min(1),
        oldPassword: z.string().min(1)
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req: any, res) => {
      try {
        const { oldPassword, newPassword, captcha, confirmPassword } = req.body
        const [tokenCapcha, captchaText] = captcha.split(',')
        let captchaInfo: any = await redis.get(tokenCapcha)
        if (!captchaInfo) {
          throw ono({
            code: 'e_invalid_captcha'
          })
        }
        captchaInfo = JSON.parse(captchaInfo)
        if (captchaInfo.text !== captchaText) {
          throw ono({
            code: 'e_invalid_captcha'
          })
        }
        if (newPassword !== confirmPassword) {
          throw ono({
            code: 'e_password_does_not_match'
          })
        }
        const userInfo = await prismaClient.user.findUnique({
          where: {
            id: req.user.id
          }
        })
        if (!userInfo) {
          throw ono({
            code: 'e_not_found_user'
          })
        }
        const checkHash = await cryptUtils.checkHash(
          oldPassword,
          userInfo.password || ''
        )
        if (!checkHash) {
          throw ono({
            code: 'e_invalid_old_password'
          })
        }
        const hash = (await cryptUtils.hash(newPassword)) as string
        await prismaClient.user.update({
          where: {
            id: userInfo.id
          },
          data: {
            password: hash,
            changePasswordAt: moment().valueOf()
          }
        })
        return res.send({ code: 0, message: 'Đổi mật khẩu thành công' })
      } catch (err: any) {
        switch (err.code) {
          case 'e_invalid_captcha':
            return res.send({ code: 1, message: 'Sai mã captcha' })
          case 'e_invalid_old_password':
            return res.send({ code: 2, message: 'Mật khẩu cũ không đúng' })
          case 'e_password_does_not_match':
            return res.send({ code: 3, message: 'Mật khẩu không khớp' })
          default:
            return res.send({
              code: -1,
              message: 'Lỗi hệ thống',
              err: err?.message
            })
        }
      }
    }
  })
}
