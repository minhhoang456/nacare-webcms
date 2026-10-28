import { prismaClient } from '../utils/prisma'
import client from '../utils/redis'
import redis from '../utils/redis'

export const partnerService = {
  getFullListHotPartners: async () => {
    const fullListHotPartner = await client.get('full_list_hot_partners')
    if (!fullListHotPartner) {
      return []
    }
    return JSON.parse(fullListHotPartner)
  },
  getListHotPartners: async () => {
    const listHotPartner = await client.get('list_hot_partners')
    if (!listHotPartner) {
      return []
    }
    return JSON.parse(listHotPartner)
  },
  refreshListPartner: async () => {
    try {
      const allPartners: any =
        await prismaClient.$queryRaw`
        SELECT 
          partner."id", partner."name", partner.logo, partner.detail, 
          partner.alt, partner.slogan, partner.website, partner.phone, 
          partner.email, partner."rulePointType", partner."billPointPercent", 
          partner."voucherId", partner."categoryName", partner."hotSequence", 
          partner_cnt.totalLike
        FROM partner 
        INNER JOIN (
          SELECT p."id",
          SUM(CASE WHEN pl."id" IS NOT NULL THEN 1 ELSE 0 END) AS totalLike
          FROM partner AS p 
          LEFT JOIN partnerlike pl ON pl."partnerId" = p."id"
          GROUP BY p."id"
        ) AS partner_cnt ON partner."id" = partner_cnt.id
        INNER JOIN (
          SELECT DISTINCT "partnerId"
          FROM producttype
          WHERE "partnerId" IS NOT NULL
            AND "isActive" = true
        ) AS partner_with_products ON partner."id" = partner_with_products."partnerId"
        WHERE partner."isActive" = true
        ORDER BY partner."hotSequence" DESC
      `
      if (allPartners.length === 0) {
        await client.del('all_partner_cache_remote')
      } else {
        await client.set(
          'all_partner_cache_remote',
          JSON.stringify(allPartners)
        )
      }
    } catch (error) {
      console.log(
        '🚀 ~ file: partner.service.ts:38 ~ refreshListPartner: ~ error:',
        error
      )
    }
  },
  refreshListHotPartnerRemoteCache: async () => {
    try {
      const fullListHotPartners = await prismaClient.partner.findMany({
        where: {
          hotSequence: {
            gt: 0
          },
          isActive: true
        },
        select: {
          id: true,
          name: true,
          logo: true,
          detail: true,
          alt: true,
          slogan: true,
          website: true,
          phone: true,
          email: true,
          rulePointType: true,
          billPointPercent: true,
          haveVoucherDefault: true,
          voucherId: true,
          categoryName: true,
          hotSequence: true
        },
        orderBy: {
          hotSequence: 'desc'
        }
      })
      if (fullListHotPartners.length === 0) return
      const listHotPartners = fullListHotPartners.map((partner: any) => {
        const { id, name, logo } = partner
        return { id, name, logo }
      })
      const pip = client.multi()
      pip.set('full_list_hot_partners', JSON.stringify(fullListHotPartners))
      pip.set('list_hot_partners', JSON.stringify(listHotPartners))
      await client.multi().exec()
    } catch (error) {
      console.log(
        '🚀 ~ file: partner.service.ts:77 ~ refreshListHotPartnerRemoteCache: ~ error:',
        error
      )
    }
  },
  runCronjob5: async () => {
    partnerService.refreshListHotPartnerRemoteCache()
    partnerService.refreshListPartner()
    partnerService.refreshPartnerCache()

  },
  /**
   * 
   * @param partnerId array partnerId
   */
  getDeliciousFoodProductTypeIdPartner: async (partnerId: any) => {
    const partner = await prismaClient.partner.findMany({
      where: {
        id: { in: partnerId }
      },
      select: {
        id: true,
        deliciousFoodProductTypeId: true
      }
    })

    return partner
  },

  refreshPartnerCache: async () => {
    try {
      const partners = await prismaClient.partner.findMany({});
      if (partners.length === 0) return [];
  
      const pipeline = redis.pipeline();
      partners.forEach((partner) => {
        pipeline.set(`partner_${partner.id}`, JSON.stringify(partner));
      });
      await pipeline.exec();
      return partners;
    } catch (error) {
      console.log(error);
      return []; 
    }
  },

  beforeCreate: async (ins: any) => {
    try {
      if (ins.deliciousFoodProductTypeId.length > 3) {
        ins.deliciousFoodProductTypeId = ins.deliciousFoodProductTypeId.slice(0, 3);
      }
    } catch (err) {
      console.log(err)
    }
    return ins
  },

  beforeUpdate: async (ins: any) => {
    try {
      if (ins.deliciousFoodProductTypeId.length > 3) {
        ins.deliciousFoodProductTypeId = ins.deliciousFoodProductTypeId.slice(0, 3);
      }
    } catch (err) {
      console.log(err)
    }
    return ins
  },

  getPartnerId: async (partnerId: number) => {
    const partner = await redis.get(`partner_${partnerId}`)
    if (!partner) {
      const partner = await prismaClient.partner.findUnique({ where: { id: partnerId } })
      await redis.set(`partner_${partnerId}`, JSON.stringify(partner))
      return partner
    }
    return JSON.parse(partner || '{}')
  }
}
export default partnerService
