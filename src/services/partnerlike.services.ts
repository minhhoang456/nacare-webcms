import { prismaClient } from '@root/src/utils/prisma'
import redis from '../utils/redis'
export const partnerLikeService = {
  bootstrap: async () => {
    try {
      redis
        .set('INIT_CACHE_PARTNERLIKE', 'LOCK', 'EX', 1 * 60 * 60, 'NX')
        .then(async (result) => {
          if (result === 'OK') {
            partnerLikeService.initCache()
          } else {
            //
          }
        })
    } catch (err) {
      console.log('🚀 ~ partnerLikeService bootstrap ~ err:', err)
    }
  },
  initCache: async () => {
    const listKeys = await redis.keys('customer_like_partner_customerId_*')
    const multi = redis.multi()
    if (listKeys.length > 0) {
      multi.del(listKeys)
    }
    const likes = await prismaClient.partnerLike.findMany()
    const customersLike: any = {}
    for (let i = 0; i < likes.length; i++) {
      const likeInfo = likes[i]
      if (likeInfo.customerId && likeInfo.partnerId) {
        if (customersLike[likeInfo.customerId]) {
          customersLike[likeInfo.customerId].push(likeInfo.partnerId)
        } else {
          customersLike[likeInfo.customerId] = []
          customersLike[likeInfo.customerId].push(likeInfo.partnerId)
        }
      }
    }
    for (const key in customersLike) {
      multi.sadd(
        `customer_like_partner_customerId_${key}`,
        ...customersLike[key]
      )
    }
    await multi.exec()
  },
  toggleLike: async (partnerId: number, customerId: number) => {
    const record = { partnerId, customerId }
    const key = `customer_like_partner_customerId_${customerId}`
    const liked = await redis.sadd(key, partnerId)
    if (liked) {
      await prismaClient.partnerLike.create({ data: record })
    } else {
      await redis.srem(key, partnerId)
      await prismaClient.partnerLike.deleteMany({ where: record })
    }
    return liked
  }
}
export default partnerLikeService
