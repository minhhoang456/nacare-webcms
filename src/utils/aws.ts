import Conf from '@src/services/conf'
import cryptUtils from '@src/utils/crypt'
import {
  CompleteMultipartUploadCommandOutput,
  DeleteObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

const awsUtil = {
  getMimeType: (fileName: string): string => {
    const ext = fileName.toLowerCase().split('.').pop() || ''
    const mimeTypes: { [key: string]: string } = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'txt': 'text/plain',
      'csv': 'text/csv',
      'json': 'application/json',
      'xml': 'application/xml',
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed'
    }
    return mimeTypes[ext] || 'application/octet-stream'
  },

  upload: async function (params: { fileName: string; buffer: Buffer }) {
    try {
      const { fileName, buffer } = params
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID || ''
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || ''
      const region = process.env.AWS_REGION || ''
      const fName = `${cryptUtils.uuid()}_${fileName}`
      const URL_AWS = Conf.get('URL_STORE_AWS_DEFAULT', 'https://s3.mpoint.vn')
      const BUCKET = process.env.AWS_BUCKET
      
      const contentType = this.getMimeType(fileName)
      
      const uploaded: CompleteMultipartUploadCommandOutput = await new Promise(
        (resolve, reject) => {
          const parallelUploads3 = new Upload({
            client: new S3Client({
              credentials: {
                accessKeyId,
                secretAccessKey
              },
              region
            }),
            tags: [],
            queueSize: 4,
            leavePartsOnError: false,
            params: {
              Bucket: BUCKET,
              Key: `${Conf.get('M1_URL_IMAGE_FOLDER', 'mpointshop')}/${fName}`,
              Body: buffer,
              ContentType: contentType,
              ContentDisposition: contentType === 'application/pdf' ? 'inline' : 'attachment'
            }
          })
          // upload to S3
          parallelUploads3.on('httpUploadProgress', (progress) => {
            console.log(`up to s3: ${progress}`)
          })
          parallelUploads3
            .done()
            .then((data) => resolve(data))
            .catch((err) => reject(err))
        }
      )
      if (uploaded && uploaded.Key) {
        return {
          fullUrl: `${URL_AWS}/${uploaded.Key}`,
          fileName: fName,
          key: uploaded.Key
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
  },
  deleteObject: async (key: string) => {
    const client = new S3Client({
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
      },
      region: process.env.AWS_REGION || ''
    })
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET,
          Key: key
        })
      )
    } finally {
      client.destroy()
    }
  },
  getFileExtension(f: string) {
    return `.${f.split('.')[f.split('.').length - 1].toLowerCase()}`
  },
  normalizeFileName: (fileName: string): string => {
    // Loại bỏ dấu, chuyển về chữ thường, thay thế khoảng trắng bằng gạch dưới và xóa các ký tự đặc biệt khác đổi tahành _
    return fileName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9._]/g, '_');
  }

}

export default awsUtil
