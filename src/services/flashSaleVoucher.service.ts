import redis from '../utils/redis'
import { prismaClient } from '@root/src/utils/prisma'
import itemService from './item.service'
import { Repository, Schema } from 'redis-om'
import ConfigSystem from '@src/config/config'
import redisClientOm from '../utils/redisOm'
import moment from 'moment'
import { FlashSaleVoucherDetail } from '@prisma/client'

type FlashSaleEntityOm = {
  id: number
  voucherId: number
  flashSaleVoucherId: number
  startTime: number
  endTime: number
  sequence: number
  fullFlashSaleInfo: string
  voucherIds: string[]
}

/**
 * Service for handling flash sale vouchers.
 */
export const flashSaleVoucherService = {
  /**
   * Retrieves the flash sale information of a voucher.
   * @param voucherId - The ID of the voucher.
   * @returns A Promise that resolves to the flash sale voucher information, or null if not found.
   */
  getFlashSaleInfoOfVoucher: async (voucherId: number) => {
    const keyFlashSaleVoucher =
      flashSaleVoucherService.getKeyFlashSaleVoucher(voucherId)
    const flashSaleVoucher = await redis.get(keyFlashSaleVoucher)
    if (!flashSaleVoucher) {
      const now = new Date().getTime()
      const flashSaleVoucherInDB =
        await prismaClient.flashSaleVoucherDetail.findFirst({
          where: {
            voucherId,
            isActive: true,
            statusOfParent: 'active',
            startTime: {
              lte: now
            },
            endTime: {
              gte: now
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        })
      if (!flashSaleVoucherInDB) {
        return null
      }
      redis
        .set(
          keyFlashSaleVoucher,
          JSON.stringify(flashSaleVoucherInDB),
          'EX',
          120
        )
        .then(() => {})
      return flashSaleVoucherInDB
    } else {
      return JSON.parse(flashSaleVoucher)
    }
  },

  /**
   * Generates the key for a flash sale voucher.
   * @param voucherId - The ID of the voucher.
   * @returns The generated key for the flash sale voucher.
   */
  getKeyFlashSaleVoucher: (voucherId: number): string => {
    return `flashSaleVoucher:${voucherId}`
  },

  removeCacheFlashSaleVoucher: async (voucherIds: number[]) => {
    const keyFlashSaleVouchers = voucherIds.map((e) =>
      flashSaleVoucherService.getKeyFlashSaleVoucher(e)
    )
    await redis.del(...keyFlashSaleVouchers)
  },

  completeHoldingFlashSaleVoucher: async (orderId: number) => {
    const orderItem = await prismaClient.orderitem.findFirst({
      where: {
        orderId
      }
    })
    if (!orderItem || !orderItem.flashSaleVoucherId) {
      return
    }
    const flashSaleInfo = await prismaClient.flashSaleVoucherDetail.findFirst({
      where: {
        id: orderItem.flashSaleVoucherId
      }
    })
    if (!flashSaleInfo) {
      return
    }
    const itemId = flashSaleInfo.itemId
    const quantity = orderItem.quantity
    if (itemId && quantity) {
      await itemService.completeHoldingByItemId(itemId, quantity)
    }
  },

  async initIndexSearchFlashSale() {
    redis
      .set('INIT_INDEX_SEARCH_FLASHSALE', 'LOCK', 'EX', 24 * 60 * 60, 'NX')
      .then(async (result) => {
        if (result === 'OK') {
          try {
            const repositoryFlashsale = this.getRepositoryRedisOm()
            try {
              await repositoryFlashsale.dropIndex()
            } catch (err) {
              console.log('🚀 ~ initIndexSearchVoucher ~ err:', err)
            }
            await repositoryFlashsale.createIndex()
          } catch (error) {
            console.log('🚀 ~ initIndexSearchVoucher ~ error:', error)
          }
        }
      })
      .catch((err) => {
        console.log('🚀 ~ initIndexSearchVoucher ~ err:', err)
      })
  },

  getRepositoryRedisOm() {
    const flashSaleRepository = new Repository(
      this.getSchemaRedisOm(),
      redisClientOm
    )
    return flashSaleRepository
  },
  getSchemaRedisOm() {
    const flashsaleSchema = new Schema(
      `${ConfigSystem.REDISEARCH_CONFIG.prefix}:flashsale_redisom`,
      {
        id: { type: 'number', sortable: true },
        voucherId: { type: 'number' },
        voucherIds: { type: 'string[]' },
        flashSaleVoucherId: { type: 'number' },
        startTime: { type: 'number', sortable: true },
        endTime: { type: 'number', sortable: true },
        sequence: { type: 'number', sortable: true },
        fullFlashSaleInfo: { type: 'text' }
      },
      {
        indexName: `${process.env.REDIS_PREFIX}:flashsale_search`,
        dataStructure: 'JSON'
      }
    )
    return flashsaleSchema
  },

  refreshListFlashSaleForRedisOm: async () => {
    try {
      const repositoryFlashSale = flashSaleVoucherService.getRepositoryRedisOm()
      const listKeyFlashSale = await redisClientOm.keys(
        `*${process.env.REDIS_PREFIX}:flashsale_redisom*`
      )
      if (listKeyFlashSale.length > 0) {
        await redisClientOm.del(listKeyFlashSale)
      }
      const startOfDay = moment().startOf('day').valueOf()
      const listFlashSale = await prismaClient.flashSaleVoucherDetail.findMany({
        where: {
          statusOfParent: 'active',
          isActive: true,
          startTime: {
            gte: startOfDay
          }
        }
      })
      if (listFlashSale.length === 0) {
        return
      }
      for (let i = 0; i < listFlashSale.length; i++) {
        const e = listFlashSale[i]
        const flashSaleEntity: FlashSaleEntityOm = {
          id: e.id,
          voucherIds: [e.voucherId.toString()],
          voucherId: e.voucherId,
          flashSaleVoucherId: e.flashSaleVoucherId,
          startTime: Number(e.startTime),
          endTime: Number(e.endTime),
          sequence: e.sequence || 0,
          fullFlashSaleInfo: JSON.stringify(e)
        }
        await repositoryFlashSale.save(String(e.id), flashSaleEntity)
      }
    } catch (err) {
      console.log('🚀 ~ refreshListFlashSaleForRedisOm: ~ err:', err)
    }
  },

  runCronjob30Minutes: async () => {
    try {
      await flashSaleVoucherService.refreshListFlashSaleForRedisOm()
    } catch (err) {
      console.log('🚀 ~ runCronjob30Minutes: ~ err:', err)
    }
  },

  bootstrap: async () => {
    await flashSaleVoucherService.initIndexSearchFlashSale()
  },

  initCache: async () => {
    flashSaleVoucherService.initIndexSearchFlashSale().then(() => {})
  },

  getFlashSaleInfoOfVoucherIds: async (voucherIds: number[]) => {
    const now = new Date().getTime()
    const repositoryRedisOMFlashSale =
      flashSaleVoucherService.getRepositoryRedisOm()
    const listFlashSaleInRedisOm = await repositoryRedisOMFlashSale
      .search()
      .where('voucherIds')
      .containOneOf(...voucherIds.map((id) => id.toString()))
      .and('startTime')
      .lte(now)
      .and('endTime')
      .gte(now)
      .sortBy('sequence', 'ASC')
      .returnAll()
    if (listFlashSaleInRedisOm.length > 0) {
      const flashSaleVouchersInRedisOm = listFlashSaleInRedisOm.map(
        (e: any) => {
          try {
            return JSON.parse(e.fullFlashSaleInfo as any)
          } catch (error) {
            return e
          }
        }
      )
      return flashSaleVouchersInRedisOm
    } else {
      return []
    }
  },

  getFlashSaleVoucherInfo: async (
    flashSaleVoucherId: number
  ): Promise<FlashSaleVoucherDetail | null> => {
    const flashSaleVoucherInRedis = await redis.get(
      `flashSaleVoucher:${flashSaleVoucherId}`
    )
    if (flashSaleVoucherInRedis) {
      return JSON.parse(flashSaleVoucherInRedis)
    }
    const flashSaleVoucherInDB =
      await prismaClient.flashSaleVoucherDetail.findFirst({
        where: {
          id: flashSaleVoucherId
        }
      })
    if (!flashSaleVoucherInDB) {
      return null
    }
    redis
      .set(
        `flashSaleVoucher:${flashSaleVoucherId}`,
        JSON.stringify(flashSaleVoucherInDB),
        'EX',
        120
      )
      .then(() => {})
    return flashSaleVoucherInDB
  }
}
export default flashSaleVoucherService
