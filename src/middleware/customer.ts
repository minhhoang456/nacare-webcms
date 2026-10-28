import { FastifyReply, FastifyRequest } from 'fastify'
import customerService from '../services/customer.service'

export default async function customerMiddleware(
  req: FastifyRequest & {
    customerId?: number
    transId?: number
    merchantId?: number
    userId?: number
  },
  res: FastifyReply
) {
  try {
    const params: any = req.params
    if (!req.headers.authorization || params.access_token) throw 'no auth'
    const token = req.headers.authorization
      ? req.headers.authorization.split(' ')[1]
      : params.access_token
    const tokenInfo = await customerService.verifyCustomerToken(token)
    await customerService.checkCustomerIsBlock(tokenInfo.customerId)
    req.customerId = tokenInfo.customerId
    if (tokenInfo.transId) {
      req.transId = tokenInfo.transId
    }
    if (tokenInfo.merchantId) {
      req.merchantId = tokenInfo.merchantId
    }
  } catch (error: any) {
    if (error.code === 'e_user_blocked') {
      return res.code(401).send({
        code: 1,
        message:
          'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ'
      })
    }
    return res.code(401).send({
      code: 1,
      message: 'Lỗi xác thực'
    })
  }
}
