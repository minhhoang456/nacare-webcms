import userMiddleware from '@src/middleware/user'
import awsUtil from '@src/utils/aws'
import downloadImageFromUrl, {
  ImageDownloadError
} from '@src/utils/downloadImageFromUrl'
import { prismaClient } from '@src/utils/prisma'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

export default async function register(fastify: FastifyInstance) {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'PUT',
    url: '/upload-image-from-url',
    onRequest: async (req) => {
      // Source URLs can contain signed query parameters, including on failures.
      Object.assign(req, { notSaveRequestLog: true })
    },
    preHandler: [async (req, reply) => userMiddleware(req, reply)],
    errorHandler: (error, req, reply) => {
      const statusCode =
        error.statusCode && error.statusCode >= 400 && error.statusCode < 500
          ? error.statusCode
          : 500
      if (statusCode === 500)
        req.log.error('Failed to process image URL request')
      return reply.code(statusCode).send({
        code: 1,
        message:
          statusCode === 500
            ? 'Không thể xử lý yêu cầu'
            : 'Dữ liệu yêu cầu không hợp lệ'
      })
    },
    schema: {
      tags: ['File'],
      summary: 'Upload ảnh từ URL lên S3',
      querystring: z.object({ accesstoken: z.string().optional() }),
      body: z.object({ url: z.string().trim().min(1).max(4096) }),
      response: {
        default: z.object({ code: z.number(), message: z.string() }),
        200: z.object({
          code: z.literal(0),
          message: z.string(),
          data: z.object({ id: z.number(), url: z.string() })
        })
      }
    },
    handler: async (req, reply) => {
      try {
        const image = await downloadImageFromUrl(req.body.url)
        const uploaded = await awsUtil.upload(image)
        if (!uploaded) {
          return reply
            .code(502)
            .send({ code: 1, message: 'Không thể lưu ảnh lên S3' })
        }
        let file: { id: number }
        try {
          file = await prismaClient.fileupload.create({
            data: {
              user:
                'userId' in req && typeof req.userId === 'number'
                  ? req.userId
                  : 0,
              fileName: image.fileName,
              fileType: 'images',
              status: 'finished',
              fullUrl: uploaded.fullUrl,
              url: uploaded.fullUrl,
              serverFileDir: 'images',
              serverFileName: uploaded.fileName
            }
          })
        } catch {
          req.log.error('Failed to save uploaded image metadata')
          try {
            await awsUtil.deleteObject(uploaded.key)
          } catch {
            req.log.error(
              { key: uploaded.key },
              'Failed to remove uploaded image after database failure'
            )
          }
          return reply
            .code(500)
            .send({ code: 1, message: 'Không thể lưu thông tin ảnh' })
        }
        return reply.send({
          code: 0,
          message: 'Thành công',
          data: { id: file.id, url: uploaded.fullUrl }
        })
      } catch (error) {
        if (error instanceof ImageDownloadError) {
          return reply
            .code(error.statusCode)
            .send({ code: 1, message: error.message })
        }
        req.log.error('Failed to upload image from URL')
        return reply
          .code(500)
          .send({ code: 1, message: 'Không thể xử lý ảnh từ URL' })
      }
    }
  })
}
