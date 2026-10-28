import { Prisma, prismaClient } from '@src/utils/prisma'
import awsUtil from '@root/src/utils/aws'
import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import userMidlleware from '@root/src/middleware/user'

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: 'PUT',
    url: `/upload-image`,
    preHandler: [userMidlleware as any],
    // Define your schema
    schema: {
      body: z.object({
        images: z.any()
      }),
      // querystring: z.object({
      // }),
      response: {}
    },
    handler: async (req: any, res) => {
      try {
        req.notSaveRequestLog = true
        const imageInfo = req.body.images
        const normalizedFileName = awsUtil.normalizeFileName(imageInfo.filename);
        const uploaded: any = await awsUtil.upload({
          buffer: await imageInfo.toBuffer(),
          fileName: normalizedFileName
        })
        const fileUploadTmp: Prisma.fileuploadCreateInput = {
          user: req?.user?.id || 0,
          fileName: normalizedFileName,
          fileType: 'images',
          status: 'finished',
          fullUrl: uploaded.fullUrl || '',
          url: uploaded.fullUrl || '',
          serverFileDir: 'images',
          serverFileName: uploaded.fileName || normalizedFileName
        }
        const filesNotCreate: any = []
        const fileCreated = await prismaClient.fileupload.create({
          data: fileUploadTmp
        })
        return res.send({
          created: [fileCreated],
          notCreated: filesNotCreate
        })
      } catch (error) {
        console.log('🚀 ~ file: upload-image.ts:46 ~ handler: ~ error:', error)
        return res.send({
          code: 1,
          message: 'Đã có lỗi xảy ra , vui lòng thử lại sau'
        })
      }
    }
  })
}
