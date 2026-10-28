import { prismaClient as prisma } from '@src/utils/prisma'
import redis from '../utils/redis'
import { Dataset } from '@prisma/client'

export const DatasetService = {
  refreshRemote: async () => {
    const dataset = await prisma.dataset.findMany()
    dataset.map(async (i: Dataset) => {
      const docs: number[] = i.data as number[]
      await redis.sadd(`dataset:${i.type.toLowerCase()}:${i.id}`, docs)
    })
  },
  async bootstrap() {
    //data lớn thì phải sửa lại
    this.refreshRemote()
  }
}
export default DatasetService
