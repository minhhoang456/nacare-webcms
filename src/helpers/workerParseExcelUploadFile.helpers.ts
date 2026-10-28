import { parentPort, workerData } from 'worker_threads'
import parseExcelUploadFile from '../utils/parseExcelUploadFile'

async function main() {
  try {
    const result = await parseExcelUploadFile(workerData.fileId)
    parentPort?.postMessage({ status: 'success', data: result })
  } catch (error) {
    console.log('🚀 ~ worker fail ~:', error)

    parentPort?.postMessage({
      status: 'error',
      message: (error as Error).message
    })
  } finally {
    process.exit(0)
  }
}

main()
