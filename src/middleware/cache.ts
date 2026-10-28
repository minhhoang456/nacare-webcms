import { FastifyReply, FastifyRequest } from 'fastify'
import cache from '@src/utils/localCache'

function promiseCreator() {
  let res
  let rej
  const prom: any = new Promise((inner_res, inner_rej) => {
    res = inner_res
    rej = inner_rej
  })
  prom.resolve = res
  prom.reject = rej
  return prom.catch((error: any) => {
    console.error('Promise rejected:', error)
    throw error // Throw the error again to ensure it's caught elsewhere if necessary
  })
}

export default async function cacheMiddleware(
  req: FastifyRequest & { cache?: any },
  res: FastifyReply
) {
  try {
    const key = `${req.method}_${req.url}_${JSON.stringify(req.body)}`
    const data = cache.get(key)
    if (data) {
      return res.send(data)
    }
    if (cache.promises[key]) {
      try {
        const data = await cache.promises[key]
        return res.status(200).send(data)
      } catch (error) {
        return res
          .status(400)
          .send({ code: -1, message: 'Lỗi hệ thống, vui lòng thử lại' })
      }
    }
    cache.promises[key] = promiseCreator()
    setTimeout(() => {
      if (cache.promises[key]) {
        cache.promises[key].reject()
        cache.promises[key] = null
      }
    }, 5000)
    req.cache = true
    // return next()
  } catch (error) {
    console.log(error)
    return res.code(403).send({
      code: 1,
      message: 'Lỗi xác thực'
    })
  }
}
