import { prismaClient } from '@src/utils/prisma'
import cache from '@src/utils/localCache'
export const pageService = {
  /**
   * Get page by id
   */
  getPage: async (id: number) => {
    const page: any = cache.get('page')
    return page[id]
  },
  /**
   * Run interval every 60 seconds
   */
  async runInterval1() {
    this.refreshCache()
  },
  /**
   * Refresh cache
   */
  refreshCache: async () => {
    const data: any = await prismaClient.page.findMany()
    const obj: any = {}
    data.map((i: any) => {
      obj[i.id] = i
    })
    cache.set('page', obj)
  },
  /**
   * bootrap run
   */
  async bootstrap() {
    this.refreshCache()
  }
}
export default pageService
