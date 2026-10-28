import Conf from '@src/services/conf'
import { FastifyReply, FastifyRequest } from 'fastify'

export default async function rootMiddleware(
  req: FastifyRequest,
  res: FastifyReply
) {
  try {
    if (!req.headers.authorization) throw 'no auth'
    const secret = req.headers.authorization.split(' ')[1]
    if (
      secret !== Conf.get('ROOT_SECRET', 'a565d01e-3dd4-4464-b8e2-9d49e3a460df')
    ) {
      return res.code(403).send({
        code: 1,
        message: 'Lỗi xác thực'
      })
    }
  } catch (error) {
    return res.code(403).send({
      code: 1,
      message: 'Lỗi xác thực'
    })
  }
}
