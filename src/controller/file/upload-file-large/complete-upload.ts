import userMidlleware from '@root/src/middleware/user'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import Conf from '@src/services/conf'
import { prismaClient } from '@root/src/utils/prisma'
import { Prisma } from '@prisma/client'
import AwsS3Service from '@root/src/utils/AwsS3Service'
export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: `/complete-upload`,
    preHandler: [userMidlleware as any],
    schema: {
      body: z.object({
        uploadId: z.any()
      }),
      response: {}
    },
    handler: async (req: any, res) => {
      const { uploadId } = req.body
      try {
        const completeData =
          await AwsS3Service.getInstance().completeMultipartUpload({
            uploadId: uploadId
          })
        if (!completeData) throw new Error('e_list_parts_failed')

        const fileCreated = await saveUploadFile(
          completeData.fileName,
          req,
          completeData
        )

        return res
          .header('Access-Control-Allow-Origin', '*')
          .header(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization, Origin, Accept'
          )
          .header('Access-Control-Allow-Credentials', 'true')
          .send({
            created: [fileCreated]
          })
      } catch (error: any) {
        console.log(
          '🚀 ~ file: complete-upload.ts:40 ~ handler: ~ error:',
          error
        )
        return res.status(500).send({
          message: msg[error.message] || 'Hệ thống bận',
          code: -1
        })
      }
    }
  })
}

const msg: any = {
  e_list_parts_failed: 'Tải file thất bại'
}

const saveUploadFile = async (
  fileName: string,
  req: any,
  completeData: any
) => {
  const URL_AWS = Conf.get('URL_STORE_AWS_DEFAULT', 'https://s3.mpoint.vn')
  const fileUploadTmp: Prisma.fileuploadCreateInput = {
    user: req?.user?.id || 0,
    fileName: fileName,
    fileType: 'files',
    status: 'finished',
    fullUrl: `${URL_AWS}/${completeData.Key}`,
    url: `${URL_AWS}/${completeData.Key}`,
    serverFileDir: 'files',
    serverFileName: fileName
  }
  const fileCreated = await prismaClient.fileupload.create({
    data: fileUploadTmp
  })
  return fileCreated
}
