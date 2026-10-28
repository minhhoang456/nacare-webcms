import { Block } from '@prisma/client'
import redis from '../utils/redis'
import { Prisma, prismaClient } from '@root/src/utils/prisma'
import ono from '@jsdevtools/ono'

export const BlockService = {
  getKeyBlock: () => {
    return 'block:products'
  },
  //-------------------- Get key limiter block cache -------------------------
  getKeyBlockCustomerCount: (blockId: number, customerId: number) => {
    return `{block_${blockId}:count:customer_${customerId}:total}`
  },

  afterCreate: async (inst: any) => {
    try {
      await redis.del(BlockService.getKeyBlock())
    } catch (err) {
      console.log('🚀 ~ afterCreate: ~ err:', err)
    }
    return inst
  },

  // beforeUpdate: async (inst: any) => {
  //   try {
  //     if (!inst.isIntegration) {
  //       const count = await prismaClient.block.count({
  //         where: {
  //           isIntegration: true
  //         }
  //       })
  //       if (count === 1) {
  //         inst.isIntegration = false
  //       }
  //     }
  //   } catch (error) {
  //     console.log(
  //       '🚀 ~ file: Block.service.ts:36 ~ beforeUpdate: ~ error:',
  //       error
  //     )
  //   }
  //   return inst
  // },

  afterUpdate: async (inst: any) => {
    try {
      await redis.del(BlockService.getKeyBlock())
      if (inst.isIntegration) {
        await prismaClient.block.updateMany({
          where: { NOT: { id: inst.id } },
          data: { isIntegration: false }
        })
      }
    } catch (err) {
      console.log('🚀 ~ afterUpdate: ~ err:', err)
    }
    return inst
  },

  getBlocks: async (
    blockId?: number,
    isIntegration?: boolean
  ): Promise<Block[]> => {
    let blocks: any = await redis.get(BlockService.getKeyBlock())
    if (blocks) {
      blocks = JSON.parse(blocks)
    } else {
      const criteria: Prisma.BlockWhereInput = {
        isActive: true
      }
      blocks = await prismaClient.block.findMany({
        where: criteria,
        orderBy: { position: 'desc' }
      })
      if (blocks.length === 0) {
        throw new Error('block_not_exits')
      }
      await redis.set(
        BlockService.getKeyBlock(),
        JSON.stringify(blocks),
        'EX',
        300
      )
    }
    if (blockId) {
      blocks = blocks.filter((block: any) => block.id === blockId)
    }
    if (isIntegration) {
      blocks = blocks.filter((block: any) => block.isIntegration === true)
    }
    if (blocks.length === 0) {
      throw new Error('block_not_exits')
    }
    return blocks
  },

  checkLimiterByBlockId: async (
    customerId: number,
    blockId: any,
    quantity: number
  ) => {
    const [blockInfo] = await BlockService.getBlocks(blockId, false)
    if (!blockInfo) {
      return false
    }
    const keyBlockCustomerCount = BlockService.getKeyBlockCustomerCount(
      blockId,
      customerId
    )
    const limitCache = await redis.incrby(keyBlockCustomerCount, quantity)
    if (!blockInfo.limitUser) {
      return
    }
    if (blockInfo.limitUser != -1 && limitCache > blockInfo.limitUser) {
      throw ono('e_out_of_block_limit')
    }
    return
  },

  getInfoBlock : async (blockId : any) => {
    const data = await prismaClient.block.findUnique({
      where: {id : blockId},
      select : {id : true , productIds : true , name : true}
    })

    if(!data) {
      return 
    }

    return data
  }
}
export default BlockService
