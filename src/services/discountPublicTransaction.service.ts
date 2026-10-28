import { messagequeueService } from './messagequeue'
import { prismaClient } from '@root/src/utils/prisma'
import redis from '@root/src/utils/redis'
import discountPublicService from './discountPublic.service'
export const discountPublicTransactionService = {
  createTransactionDiscountPublic: async (code: string, customerId: number) => {
    const [transactionInfo] =
      await prismaClient.discountpublictransaction.findMany({
        where: {
          customerId,
          code
        },
        take: 1
      })
    if (!transactionInfo) {
      messagequeueService.addDbItem({
        action: 'create',
        model: 'discountpublictransaction',
        data: { code, customerId }
      })
    } else {
      const key = discountPublicService.getKeyDiscountCustomerCount(
        code,
        customerId
      )
      const countUsed = await redis.get(key)
      messagequeueService.addDbItem({
        action: 'update',
        model: 'discountpublictransaction',
        data: { countUsed },
        updateCrit: { code, customerId }
      })
    }
  }
}
export default discountPublicTransactionService
