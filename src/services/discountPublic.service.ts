import ono from '@jsdevtools/ono'
import redis from '@src/utils/redis'
import { prismaClient } from '@root/src/utils/prisma'
export const discountPublicService = {
  getKeyDiscountCount: (code: string) => {
    return `{discount_${code}}:count:total`
  },

  getKeyDiscountCustomerCount: (code: string, customerId: number) => {
    return `{discount_${code}:count:customer_${customerId}:total}`
  },

  checkLimitDiscount: async (code: string, customerId: number) => {
    const pip = redis.multi()
    const keyDiscountCount = discountPublicService.getKeyDiscountCount(code)
    const keyDiscountCustomerCount =
      discountPublicService.getKeyDiscountCustomerCount(code, customerId)
    pip.incrby(keyDiscountCount, 1) // limitProgram
    pip.incrby(keyDiscountCustomerCount, 1) // limitUserProgram

    const listIncr: any = await pip.exec()
    const [discountPublicInfo] = await prismaClient.discountpublic.findMany({
      where: {
        code: code
      },
      take: 1
    })
    if (!discountPublicInfo) {
      return
    }
    const arrLimited: any = []
    arrLimited.push(
      { key: 'program', max: discountPublicInfo.limitProgram },
      { key: 'user_program', max: discountPublicInfo.limitUserProgram }
    )

    for (let i = 0; i < arrLimited.length; i++) {
      if (arrLimited[i].max > -1 && listIncr[i] > arrLimited[i].max) {
        await discountPublicService.rollBackLimitDiscount(code, customerId)
        throw ono(`e_limit_discount_${arrLimited[i].key}`)
      }
    }
  },

  rollBackLimitDiscount: async (code: string, customerId: number) => {
    const pip = redis.multi()
    const keyDiscountCount = discountPublicService.getKeyDiscountCount(code)
    const keyDiscountCustomerCount =
      discountPublicService.getKeyDiscountCustomerCount(code, customerId)
    pip.incrby(keyDiscountCount, -1) // limitProgram
    pip.incrby(keyDiscountCustomerCount, -1) // limitUserProgram
    await pip.exec()
  },

  addLimiterForDiscount: async (id: number) => {
    const [discountInfo] = await prismaClient.discount.findMany({
      where: {
        id
      },
      take: 1
    })
    let [discountPublicInfo] = await prismaClient.discountpublic.findMany({
      where: {
        code: discountInfo.code
      },
      take: 1
    })
    if (!discountPublicInfo) {
      discountPublicInfo = await prismaClient.discountpublic.create({
        data: {
          code: discountInfo.code
        }
      })
    }
    return discountPublicInfo
  }
}
export default discountPublicService
