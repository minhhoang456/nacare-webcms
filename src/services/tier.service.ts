import ono from '@jsdevtools/ono'
import redis from '@root/src/utils/redis'
import { prismaClient } from '@root/src/utils/prisma'

export const tierService = {
  getTierByPoint: async (point = 0) => {
    if (point < 0) throw ono('e_invalid_point')
    const listTierInfos = await tierService.getListTierInfos()
    for (let i = listTierInfos.length - 1; i >= 0; i--) {
      if (listTierInfos[i].upgradePoint <= point) {
        return listTierInfos[i]
      }
    }
  },
  getTierById: async (id: number) => {
    const listTierInfos = await tierService.getListTierInfos()
    const [tierInfo] = listTierInfos.filter((i: any) => i.id === id)
    return tierInfo
  },
  getListTierInfos: async () => {
    const listTierInfos: any = await redis.get('tier')
    return JSON.parse(listTierInfos)
  },
  runCronjob5: async () => {
    try {
      await tierService.refreshRemoteCache()
    } catch (error) {
      console.log(
        '🚀 ~ file: tier.service.ts:28 ~ runCronjob5: ~ error:',
        error
      )
    }
  },
  refreshRemoteCache: async () => {
    try {
      const tierInfos = await prismaClient.tier.findMany({
        orderBy: {
          id: 'asc'
        }
      })
      if (tierInfos.length === 0) {
        return
      }
      await redis.set('tier', JSON.stringify(tierInfos))
    } catch (error) {
      console.log(
        '🚀 ~ file: tier.service.ts:46 ~ refreshRemoteCache: ~ error:',
        error
      )
    }
  }
}
export default tierService
