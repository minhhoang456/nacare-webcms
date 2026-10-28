import User from '@root/src/services/user.service'
import cryptUtils from '@src/utils/crypt'
import pageMiddleware from '@src/middleware/page'
import userMidlleware from '@root/src/middleware/user'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import actionLogMidlleware from '@root/src/middleware/actionLog'
import ono from '@jsdevtools/ono'
import common from '@root/src/utils/common'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/create-user`,
    preHandler: [userMidlleware as any, pageMiddleware, actionLogMidlleware],
    // Define your schema
    schema: {
      body: z.object({
        name: z.string().min(2).describe('Tên người dùng'),
        phone: z.string().min(10).max(10).optional().describe('SĐT'),
        email: z.string().optional(),
        roleId: z.number().describe('Nhóm quyền'),
        gender: z.string().optional(),
        address: z.string().optional(),
        username: z.string().min(2),
        password: z.string().min(1),
        confirmPassword: z.string().min(1),
        avatar: z.string().optional(),
        sourceId: z.number().optional(),
        partnerIds: z.array(z.number()).optional()
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req, res) => {
      try {
        const inputs: any = req.body
        if (inputs.password !== inputs.confirmPassword) {
          throw ono({
            code: 'e_confirm_password_incorrect'
          })
        }
        if (!common.checkPasswordStrength(inputs.password)) {
          throw ono({
            code: 'e_password_not_enough_strong'
          })
        }
        if (!common.checkUserNameStrength(inputs.username)) {
          throw ono({
            code: 'e_username_not_enough_strong'
          })
        }
        inputs.password = await cryptUtils.hash(inputs.password)
        delete inputs.confirmPassword
        await User.createUserAccount(inputs)
        return res.send({
          code: 0,
          message: 'Tạo tài khoản thành công'
        })
      } catch (error: any) {
        switch (error.code) {
          case 'e_confirm_password_incorrect': {
            return res.code(400).send({
              code: 1,
              message: 'Xác nhận mật khẩu không chính xác'
            })
          }
          case 'e_password_not_enough_strong': {
            return res.code(400).send({
              code: 1,
              message: 'Mật khẩu không đủ mạnh'
            })
          }
          case 'e_username_not_enough_strong': {
            return res.code(400).send({
              code: 1,
              message: 'Tên đăng nhập không hợp lệ'
            })
          }
          case 'e_user_exist': {
            return res.code(400).send({
              code: 1,
              message: 'Tài khoản đã tồn tại'
            })
          }
          case 'E_INVALID_NEW_RECORD': {
            return res.code(400).send({
              code: 1,
              message: 'Email không chính xác !'
            })
          }
          default: {
            return res.code(500).send({
              code: 1,
              message: 'Không tạo được tài khoản',
              error
            })
          }
        }
      }
    }
  })
}
