import cryptUtils from '@src/utils/crypt'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import svgCaptcha from 'svg-captcha'
import redis from '@src/utils/redis'
import Conf from '@src/services/conf'
// import { z } from "zod";

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: `/create-captcha`,
    // Define your schema
    schema: {
      // body:{},
      // querystring: {},
      response: {}
    },
    handler: async (_req, res) => {
      try {
        const data = svgCaptcha.create({
          background: '#fff',
          noise: 4,
          ignoreChars: '0o1i',
          charPreset: '0123456789'
        })

        const token = cryptUtils.uuid()
        await redis.set(
          token,
          JSON.stringify({ text: data.text }),
          'EX',
          Conf.get('TOKEN_CAPCHA_EXPIRE', 180)
        )
        return res.send({
          code: 0,
          message: 'Thành công',
          data: data.data,
          tokenCapcha: token
        })
      } catch (err) {
        return res.send({ code: -1, message: 'Lỗi hệ thống' })
      }
    }
  })
}
