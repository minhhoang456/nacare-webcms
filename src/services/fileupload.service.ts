import Conf from '@src/services/conf'
import path from 'path'
export const fileuploadService: any = {
  // beforeCreate: async (instance: any) => {
  //   instance.url = `${Conf.get('BASE_URL')}/${instance.serverFileDir}/${
  //     instance.serverFileName
  //   }`
  //   return instance
  // },
  dir: {
    images: path.join(__dirname, '../../upload/images'),
    other: path.join(__dirname, '../../upload/files'),
    files: path.join(__dirname, '../../upload/files'),
    private: path.join(__dirname, '../../upload/files'),
    upload: path.join(__dirname, '../../upload')
  },
  getFilePath: (fileUpload: any) => {
    const filePath = path.join(
      fileuploadService.dir[fileUpload.serverFileDir],
      fileUpload.serverFileName
    )
    return filePath
  },
  isImage: (fileUpload: any) => {
    if (fileUpload && fileUpload.fileType) {
      return fileUpload.fileType.toLowerCase().includes('image')
    } else {
      return false
    }
  },
  getLinkImage: (fileUpload: any) => {
    if (!fileuploadService.isImage(fileUpload)) {
      return {
        status: false,
        url: ''
      }
    }
    return {
      status: true,
      url: `${Conf.get('BASE_URL')}/${fileUpload.serverFileDir}/${
        fileUpload.serverFileName
      }`
    }
  },
  customToJSON: function () {
    const link = fileuploadService.getLinkImage(this)
    if (link.status && this.serverFileDir === 'images') {
      this.url = link.url
    }
    return this
  }
}
export default fileuploadService
