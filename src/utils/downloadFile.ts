import pathUtils from 'path'
import download from 'download-file'

async function downloadFile(url: string, path: string) {
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'
  const options = {
    directory: pathUtils.dirname(path),
    filename: getFileNameFromUrl(url) //pathUtils.basename(path)
  }
  await new Promise((resolve, reject) => {
    download(url, options, (err: any) => {
      if (err) {
        console.log('downloadFile error', err)
        return reject()
      }
      return resolve(true)
    })
  })
}
export default downloadFile

function getFileNameFromUrl(url: string) {
  const pathComponents = url.split('/')
  const fileName = pathComponents[pathComponents.length - 1]
  return fileName
}
