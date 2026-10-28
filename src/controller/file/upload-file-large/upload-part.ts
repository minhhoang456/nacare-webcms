import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import userMidlleware from '@root/src/middleware/user'
import AwsS3Service from '@root/src/utils/AwsS3Service'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'PUT',
    url: `/upload-part`,
    preHandler: [userMidlleware as any],
    schema: {
      body: z.object({
        file: z.any()
      }),
      query: z.object({
        uploadId: z.string(),
        index: z.number().or(z.string().transform(Number)),
      }),
      response: {}
    },
    handler: async (_req: any, res) => {
      try {
        const chunk = _req.body.file
        if (!chunk) {
          return res
            .code(400)
            .send({ code: 1, message: 'Invalid chunk data received' })
        }
        const { uploadId, index } = _req.query

        const uploadResponse: any = await AwsS3Service.getInstance().uploadPart(
          {
            UploadId: uploadId,
            PartNumber: index + 1,
            Body: await chunk.toBuffer()
          }
        )

        if (!uploadResponse) {
          console.error(
            'Upload failed: No result returned from awsUtil.uploadChunk'
          )
          return res.code(500).send({ code: 1, message: 'Failed to upload' })
        }
        const cleanResponse = {
          uploadId: uploadId,
          partNumber: index + 1,
          ETag: uploadResponse.ETag,
          message: `Part ${index} uploaded successfully.`,
        }

        // return res.raw
        //   .writeHead(200, {
        //     'Content-Type': 'application/json',
        //     'Access-Control-Allow-Origin': '*',
        //     'Access-Control-Allow-Headers':
        //       'Content-Type, Authorization, Origin, Accept',
        //     'Access-Control-Allow-Credentials': 'true'
        //   })
        //   .end(cleanResponse)
        return res
          .header('Access-Control-Allow-Origin', '*')
          .header(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization, Origin, Accept'
          )
          .header('Access-Control-Allow-Credentials', 'true')
          .send(cleanResponse)
      } catch (error: any) {
        return res.code(500).send({
          code: -1,
          message: msg[error.message] || 'Hệ thống bận'
        })
      }
    }
  })
}

const msg: any = {
  e_upload_failed: 'Tải lên video thất bại.',
  e_buffer_empty: 'Không tìm thấy file buffer.'
}
