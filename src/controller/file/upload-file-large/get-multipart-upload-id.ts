import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import userMidlleware from '@src/middleware/user'
import AwsS3Service from '@root/src/utils/AwsS3Service'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/get-multipart-upload-id`,
    preHandler: [userMidlleware as any],
    schema: {
      body: z.object({
        fileName: z.string()
      }),
      response: {}
    },
    handler: async (req: any, res) => {
      const { fileName } = req.body
      try {
        const UploadId = await AwsS3Service.getInstance().createMultipartUpload({ fileName })
        console.log("🚀 ~ handler: ~ UploadId:", UploadId)
        return res.send({
          UploadId,
          code: 0
        })
      } catch (error: any) {
        return res.status(500).send({
          message: msg[error.message] || 'Hệ thống bận',
          code: -1
        })
      }
    }
  })
}

const msg: any = {
  e_create_multipart_upload_id: 'e_create_multipart_upload_id'
}