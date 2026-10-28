// import Conf from '@src/services/conf'
import moment from 'moment'
import { prismaClient } from '../utils/prisma'
import redis from '@root/src/utils/redis'
export const shopService = {
  afterFindMany: async (ins: any) => {
    try {
      ins.forEach((i: any) => {
        if (i.closeTime && typeof i.closeTime === 'string') {
          i.closeTime = moment(i.closeTime, 'HH:mm').valueOf()
        } else {
          i.closeTime = 0
        }
      })
    } catch (error) {
      console.log(error)
    }
    return ins
  },
  beforeCreate: async (ins: any) => {
    try {
      if (ins.closeTime && typeof ins.closeTime === 'number') {
        ins.closeTime = moment(ins.closeTime).format('HH:mm')
      }
    } catch (err) {
      console.log(err)
    }
    return ins
  },
  beforeUpdate: async (ins: any) => {
    try {
      if (ins.closeTime && typeof ins.closeTime === 'number') {
        ins.closeTime = moment(ins.closeTime).format('HH:mm')
      }
    } catch (err) {
      console.log(err)
    }
    return ins
  },
  syncShopGPS: async () => {
    // let soureIds = Conf.get('SOURCE_ID_SHOP', '3,1')
    // soureIds = soureIds.split(',')
    const shopInfos = await prismaClient.shop.findMany({
      where: {
        isActive: true
        // sourceId: {
        //   in: soureIds.map((e: any) => Number(e))
        // }
      },
      select: {
        id: true,
        gps: true,
        partnerId: true,
        phone: true,
        name: true,
        address: true,
        provinceId: true,
        districtId: true,
        wardId: true,
        closeTime: true
      }
    })
    if (shopInfos.length === 0) {
      return
    }
    const multi: any = redis.multi()
    multi.del('SHOP_GPS')
    shopInfos.forEach((shop) => {
      if (!shop.gps) {
        return
      }
      const arr = shop.gps.split('/')
      const lat = Number(arr[0])
      const lng = Number(arr[1])
      if (isNaN(lat) || isNaN(lng)) {
        return
      }
      multi.geoadd(['SHOP_GPS', lng, lat, `${JSON.stringify(shop)}`])
    })
    await multi.exec()
    return
  },
  runCronjob5: async () => {
    try {
      shopService.syncShopGPS()
    } catch (error) {
      console.log(
        '🚀 ~ file: shop.service.ts:87 ~ runCronjob5: ~ error:',
        error
      )
    }
  },
  getListSortedShops: async (lat: any, lng: any, radius: any) => {
    const rs = await redis.georadius(
      'SHOP_GPS',
      lng,
      lat,
      radius,
      'km',
      'WITHDIST',
      'WITHCOORD',
      'ASC'
    )
    const shops: any = []
    rs.forEach((i: any) => {
      const shopInfo = JSON.parse(i[0])
      shopInfo.distance = Number(i[1])
      shopInfo.lat = Number(i[2][1])
      shopInfo.long = Number(i[2][0])
      shopInfo.shopId = shopInfo.id
      shops.push(shopInfo)
    })
    return shops
  },
  getPartnerDistance: async (lat: any, lng: any) => {
    const rs = await redis.georadius(
      'SHOP_GPS',
      lng,
      lat,
      9999999,
      'km',
      'WITHDIST'
    )
    const partnerDistance: any = {}
    rs.forEach((i: any) => {
      const shopInfo = JSON.parse(i[0])
      const distance = Number(i[1])
      const partnerId = shopInfo.partnerId
      if (!partnerDistance[partnerId]) {
        partnerDistance[partnerId] = distance
      } else if (partnerDistance[partnerId] > distance) {
        partnerDistance[partnerId] = distance
      }
    })
    return partnerDistance
  }
}
export default shopService
