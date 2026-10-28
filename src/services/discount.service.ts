import ono from '@jsdevtools/ono'
import { prismaClient } from '../utils/prisma'
import discountPublicTransactionService from './discountPublicTransaction.service'
import redis from '@root/src/utils/redis'

export const discountService = {
  getCodeInfoByCode: async (code: string) => {
    // code = sails.services.crypt.validCouponCode(code);
    if (!code) throw ono({ code: 'code_is_not_valid' })
    const [codeInfo]: any = await prismaClient.discount.findMany({
      where: { code: code.toUpperCase() },
      take: 1
    })
    if (!codeInfo) throw ono({ code: 'code_is_not_valid' })
    if (codeInfo.used) throw ono({ code: 'code_is_used' })
    if (codeInfo.expiredAt < new Date().getTime())
      throw ono({ code: 'code_is_expired' })
    return codeInfo
  },
  useDiscountCode: async (code: string, customerId: number) => {
    if (!code) throw ono({ code: 'code_is_not_valid' })
    const [codeInfo] = await prismaClient.discount.findMany({
      where: { code: code.toUpperCase() },
      take: 1
    })
    if (codeInfo.isDiscountPublic === true) {
      await discountPublicTransactionService.createTransactionDiscountPublic(
        code,
        customerId
      )
      return
    }
    //check code used
    const isNotUse = await redis.sadd('discount_codes_used', code)
    if (!isNotUse) throw ono({ code: 'code_is_used' })
    if (codeInfo.used) throw ono({ code: 'code_is_used' })
    await prismaClient.discount.update({
      where: { id: codeInfo.id },
      data: {
        used: true,
        usedAt: new Date().getTime(),
        customerId
      }
    })
    try {
      await prismaClient.code.update({
        where: {
          id: codeInfo.id
        },
        data: {
          used: true,
          usedAt: new Date().getTime()
        }
      })
    } catch (error) {
      console.log(error)
    }
    return codeInfo
  }
}
export default discountService
