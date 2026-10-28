import fs from 'fs'
import pathUtils from 'path'
import axios from 'axios'

async function downloadFileV2(url: string, path: string) {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

  const folderPath = pathUtils.dirname(path)
  const fileName = getFileNameFromUrl(url)
  try {
    const response = await axios.get(url, { responseType: 'stream' })
    const filePath = pathUtils.join(folderPath, fileName)
    await fs.promises.mkdir(folderPath, { recursive: true })
    const writer = fs.createWriteStream(filePath)
    response.data.pipe(writer)
    console.log(`File downloaded successfully: ${filePath}`)
    return await new Promise((resolve, reject) => {
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
  } catch (error) {
    console.error('Error downloading file from S3:', error)
    throw error
  }
}
export default downloadFileV2

function getFileNameFromUrl(url: string) {
  const pathComponents = url.split('/')
  const fileName = pathComponents[pathComponents.length - 1]
  return fileName
}
