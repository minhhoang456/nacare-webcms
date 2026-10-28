import { prismaClient } from '../utils/prisma'
import redis from '../utils/redis'

export const popupServiceService = {
  getActivePopup: async () => {
    const data = await redis.get('popup')
    if (!data) {
      const popup = await prismaClient.popup.findMany({
        where: {
          isActive: true,
          startDate: { lte: new Date().getTime() },
          endDate: { gte: new Date().getTime() }
        },
        take: 1,
        orderBy: { id: 'desc' }
      })
      if (popup.length === 0) return null
      await redis.set('popup', JSON.stringify(popup[0]), 'EX', 300)
      return popup[0]
    }
    return JSON.parse(data)
  }
}
export default popupServiceService
