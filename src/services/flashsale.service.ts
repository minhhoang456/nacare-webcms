import cache from '@src/utils/localCache'
import redis from '@src/utils/redis'
import { prismaClient } from '../utils/prisma'
import redisClientOm from '../utils/redisOm'
export const flashsaleService = {
  getFlashSaleInfo: (flashSaleId: any) => {
    const flashSaleInfos: any = cache.get('flashsale')
    const [flashSaleInfo] = flashSaleInfos.filter(
      (i: any) => i.id === flashSaleId
    )
    return flashSaleInfo
  },
  getListFlashSales: async () => {
    let flashSaleInfos: any = await redis.get('flashsale')
    if (!flashSaleInfos) {
      return []
    } else {
      flashSaleInfos = JSON.parse(flashSaleInfos)
    }
    const rs: any = []
    const now = new Date().getTime()
    flashSaleInfos.forEach((i: any) => {
      if (i.startDate < now && i.endDate > now) {
        rs.push(i)
      }
    })
    return rs
  },
  // initCache: async () => {
  //   try {
  // flashsaleService.initIndexFlashSale()
  // } catch (err) {
  //   console.log(err)
  // }
  // },
  getListFlashSalesV2: async () => {
    let flashSaleInfos = await redis.get('flashsale')
    if (!flashSaleInfos) {
      return []
    } else {
      flashSaleInfos = JSON.parse(flashSaleInfos)
    }
    return flashSaleInfos
  },
  runCronjob5: async () => {
    // flashsaleService.refreshRemoteCache()
  },
  refreshRemoteCache: async () => {
    try {
      const now = new Date().getTime()
      const flashSaleInfos = await prismaClient.flashsale.findMany({
        where: {
          isActive: true,
          endDate: {
            gt: now
          }
        }
      })
      if (flashSaleInfos.length === 0) {
        return
      }
      await redis.set('flashsale', JSON.stringify(flashSaleInfos))
      return flashSaleInfos
    } catch (error) {
      console.log(
        '🚀 ~ file: flashsale.service.ts:65 ~ refreshRemoteCache: ~ error:',
        error
      )
      return
    }
  },
  initIndexFlashSale: async () => {
    try {
      await redisClientOm.dropindex(
        flashsaleService.getKeyIndexRedisearchFlashsale()
      )
    } catch (err) {
      console.log(err)
    }
    try {
      await redisClientOm.create(
        flashsaleService.getKeyIndexRedisearchFlashsale(),
        'HASH',
        [
          { name: 'id', type: 'NUMERIC', sortable: true },
          { name: 'flashSalePrice', type: 'NUMERIC' },
          { name: 'flashSaleQuantity', type: 'NUMERIC', sortable: true },
          { name: 'startTime', type: 'NUMERIC', sortable: true },
          { name: 'productTypeId', type: 'NUMERIC' },
          { name: 'endTime', type: 'NUMERIC', sortable: true }
        ],
        {
          prefix: {
            num: 1,
            prefixes: `${process.env.REDIS_PREFIX}megapoint_index_flashsale`
          }
        }
      )
    } catch (error) {
      console.log(
        '🚀 ~ file: flashsale.service.ts:100 ~ initIndexFlashSale: ~ error:',
        error
      )
    }
  },
  getKeyIndexRedisearchFlashsale: () => {
    return `${process.env.REDIS_PREFIX}megapoint_index_flashsale`
  },
  getKeyFlashSale: (productId: number, startTime: number, endTime: number) => {
    return `megapoint_index_flashsale_${productId}_${startTime}_${endTime}`
  },
  createCacheFlashsale: async (
    productInfos: any,
    startTime: number,
    endTime: number
  ) => {
    const multi = redisClientOm.redisNormal.multi()
    productInfos.forEach((e: any) => {
      const productInsertToRedissearch = {
        id: e.id,
        flashSalePrice: e.flashSalePrice,
        flashSaleQuantity: e.flashSaleQuantity,
        startTime: startTime,
        endTime: endTime,
        productTypeId: e.productTypeId
      }
      const ttlKey = endTime - new Date().getTime()
      if (ttlKey >= 0) {
        const key = flashsaleService.getKeyFlashSale(e.id, startTime, endTime)
        multi.hmset(key, productInsertToRedissearch)
        multi.pexpire(key, ttlKey)
      }
    })
    await redisClientOm.redisNormal.runMulti(multi)
  },
  getFlashSaleInfoByProductType: async (productTypeId: number) => {
    const time = new Date().getTime()
    const querySearch = `@startTime:[-inf,(${time}] @endTime:[(${time},+inf] @productTypeId:[${productTypeId},${productTypeId}]`
    const result = await redisClientOm.search(
      flashsaleService.getKeyIndexRedisearchFlashsale(),
      querySearch,
      {}
    )
    if (typeof result === 'number') {
      return []
    }
    return result.slice(1, result.length + 1)
  }
}
export default flashsaleService
