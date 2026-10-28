import {
  CompleteMultipartUploadCommand,
  CompleteMultipartUploadCommandOutput,
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCommand
} from '@aws-sdk/client-s3'
import Conf from '@src/services/conf'
import ono from '@jsdevtools/ono'
import redis from './redis'
import crypt from './crypt'
import { Upload } from '@aws-sdk/lib-storage'
import mime from 'mime-types'

interface UploadPartParams {
  UploadId: string
  PartNumber: number
  Body: Buffer
}

interface MultipartUploadParams {
  fileName: string
}

interface ListPartsParams {
  fileName?: string
  uploadId: string
}

interface CompleteMultipartUploadParams {
  uploadId: string
}

interface UploadImageParams {
  fileName: string
  buffer: Buffer
}

export default class AwsS3Service {
  private static instance: AwsS3Service
  private s3Client: S3Client

  private constructor() {
    this.s3Client = new S3Client({
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
      },
      region: process.env.AWS_REGION || ''
    })
  }

  public static getInstance(): AwsS3Service {
    if (!AwsS3Service.instance) {
      AwsS3Service.instance = new AwsS3Service()
    }
    return AwsS3Service.instance
  }

  private buildS3Key(fileName: string) {
    return {
      Bucket: process.env.AWS_BUCKET,
      Key: `${Conf.get('M1_URL_IMAGE_FOLDER', 'mpointshop')}/${fileName}`
    }
  }

  public async createMultipartUpload({
    fileName
  }: MultipartUploadParams): Promise<string> {
    try {
      const fName = `${crypt.uuid()}_${fileName}`
      const command = new CreateMultipartUploadCommand(this.buildS3Key(fName))
      const { UploadId, Key } = await this.s3Client.send(command)
      if (!UploadId || !Key) throw ono('e_create_multipart_upload')

      const uploadData: any = {
        uploadId: UploadId,
        key: Key,
        fileName: fName,
        parts: []
      }
      await redis.set(`multi_upload:${UploadId}`, JSON.stringify(uploadData))
      return UploadId
    } catch (error) {
      console.error('Error creating multipart upload:', error)
      throw error
    }
  }

  public async uploadPart({ UploadId, PartNumber, Body }: UploadPartParams) {
    try {
      const uploadKey = `multi_upload:${UploadId}`
      const uploadDataStr = await redis.get(uploadKey)
      if (!uploadDataStr) return null
      const uploadData = JSON.parse(uploadDataStr)
      const params = {
        UploadId,
        PartNumber,
        Body,
        ...this.buildS3Key(uploadData.fileName)
      }

      const command = new UploadPartCommand(params)
      const { ETag } = await this.s3Client.send(command)

      const partKey = `multi_upload_parts:${UploadId}`
      const partInfo = JSON.stringify({
        PartNumber: PartNumber,
        ETag: ETag
      })
      const multi = redis.multi()
      multi.zadd(partKey, PartNumber, partInfo)
      multi.expire(partKey, 24 * 60 * 60)
      multi.expire(uploadKey, 24 * 60 * 60)
      await multi.exec()

      return { PartNumber, ETag }
    } catch (error) {
      console.error('Error uploading part:', error)
      throw error
    }
  }

  public async listParts({ uploadId }: ListPartsParams) {
    try {
      const partKey = `multi_upload_parts:${uploadId}`
      const parts = await redis.zrange(partKey, 0, -1)

      return parts.map((part) => JSON.parse(part))
    } catch (error) {
      console.error('Get all parts error:', error)
      return []
    }
  }

  public async completeMultipartUpload({
    uploadId
  }: CompleteMultipartUploadParams) {
    try {
      const uploadDataStr = await redis.get(`multi_upload:${uploadId}`)
      if (!uploadDataStr) return null
      const uploadData = JSON.parse(uploadDataStr)
      const parts = await this.listParts({ uploadId })

      const params = {
        ...this.buildS3Key(uploadData.fileName),
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
        }
      }

      const command = new CompleteMultipartUploadCommand(params)
      const response = await this.s3Client.send(command)

      const multi = redis.multi()
      multi.del(`multi_upload:${uploadId}`)
      multi.del(`multi_upload_parts:${uploadId}`)
      await multi.exec()

      return { ...response, fileName: uploadData.fileName }
    } catch (error) {
      console.error('Error completing multipart upload:', error)
      throw error
    }
  }

  public async uploadImage(params: UploadImageParams): Promise<any | null> {
    try {
      const { fileName, buffer } = params
      const fName = `${crypt.uuid()}_${fileName}`
      const detectedContentType = mime.lookup(fileName) || 'application/octet-stream'

      const uploaded: CompleteMultipartUploadCommandOutput = await new Promise(
        (resolve, reject) => {
          const parallelUploads3 = new Upload({
            client: this.s3Client,
            params: {
              ...this.buildS3Key(fName),
              Body: buffer,
              ContentType: detectedContentType
            },
            tags: [],
            queueSize: 4,
            partSize: 5 * 1024 * 1024,
            leavePartsOnError: false
          })
          parallelUploads3
            .done()
            .then((data: any) => resolve(data))
            .catch((err: any) => reject(err))
        }
      )
      if (uploaded?.Key) {
        return {
          fullUrl: `${Conf.get(
            'URL_STORE_AWS_DEFAULT',
            'https://s3.mpoint.vn'
          )}/${uploaded.Key}`,
          fileName: fName
        }
      }
      return null
    } catch (err) {
      console.log(
        '🚀 ~ file: file.service.ts:519 ~ FileService ~ uploadFileToAws ~ err:',
        err
      )
      return null
    }
  }
}
