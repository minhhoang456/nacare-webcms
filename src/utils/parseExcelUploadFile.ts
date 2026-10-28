import path from 'path'
import xlsx from 'node-xlsx'
import { fileuploadService } from '../services'
import ono from '@jsdevtools/ono'
import { prismaClient } from './prisma'
// import downloadFile from './downloadFile'
import downloadFileV2 from './downloadFileV2'

async function parseExcelUploadFile(file: number) {
  const fileUploadInfo: any = await prismaClient.fileupload.findFirst({
    where: { id: file }
  })
  if (!fileUploadInfo) throw ono('e_invaild_upload_file')
  if (!fileUploadInfo[`server1`]) {
    //download file if not exits in our server
    try {
      await downloadFileV2(
        fileUploadInfo.fullUrl,
        path.join(
          fileuploadService.dir.upload,
          fileUploadInfo.serverFileDir,
          fileUploadInfo.serverFileName
        )
      )
    } catch (error) {
      throw ono('e_invaild_upload_file')
    }

    await prismaClient.fileupload.update({
      where: { id: fileUploadInfo.id },
      data: {
        server1: true
      }
    })
  }
  let raw = null
  try {
    const fileParse = path.join(
      fileuploadService.dir.upload,
      fileUploadInfo.serverFileDir,
      fileUploadInfo.serverFileName
    )
    raw = xlsx.parse(fileParse)
  } catch (err) {
    await prismaClient.fileupload.update({
      where: { id: fileUploadInfo.id },
      data: {
        server1: false
      }
    })
    throw ono('e_invaild_upload_file')
  }
  return raw
}
export default parseExcelUploadFile
