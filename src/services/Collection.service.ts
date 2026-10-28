import redis from '../utils/redis'
import { prismaClient } from '../utils/prisma'
export const CollectionService = {
  getCollectionKey: () => {
    return `cache_collections`
  },
  runCronjob5: async () => {
    try {
      await CollectionService.refreshCollection()
    } catch (error) {
      console.log(
        '🚀 ~ file: collection.service.ts:12 ~ runCronjob5: ~ error:',
        error
      )
    }
  },
  async refreshCollection() {
    try {
      const collections = await prismaClient.collection.findMany({
        where: {
          isActive: true
        },
        orderBy: {
          position: 'asc'
        }
      })
      const collectionTabs = collections.map((i: any) => {
        return { id: i.id, name: i.name, voucherIds: i.voucherIds }
      })
      await redis.set(
        this.getCollectionKey(),
        JSON.stringify({ collections, collectionTabs })
      )
      return { collections, collectionTabs }
    } catch (error) {
      console.log('🚀 ~ file: collection.service.ts ~ error', error)
      return []
    }
  },
  getCollections: async (skip: number, limit: number) => {
    let collectionData: any
    const collectionCache: string | null = await redis.get(
      CollectionService.getCollectionKey()
    )
    if (collectionCache) {
      collectionData = JSON.parse(collectionCache)
      if (!collectionData.collections || !collectionData.collectionTabs) {
        collectionData = await CollectionService.refreshCollection()
      }
    } else {
      collectionData = await CollectionService.refreshCollection()
    }
    return {
      collectionTabs: collectionData.collectionTabs,
      collections: collectionData.collections.slice(skip, skip + limit),
      total: collectionData.collections.length
    }
  }
}
export default CollectionService
