import redis from '../utils/redis';
import { prismaClient } from '../utils/prisma';
export const rateService = {
  runCronjob5: async () => {
    await rateService.refreshCache();
  },

  bootstrap: async () => {
    await rateService.refreshCache();
  },

  getRateCommon: async (condition?: any) => {
    const rates = await prismaClient.rate.findMany({
      where: condition,
      omit: {
        customerId: true,
      },
      orderBy: {
        star: 'desc',
      },
    });
    return rates;
  },

  getInfoRateProduct: async (productTypeId: number) => {
    const cachedRate = await rateService.getCacheCommon(productTypeId);
    if (cachedRate.length) return cachedRate;
    const rates = await rateService.getRateCommon({ productTypeId });
    if (!rates.length) return [];
    await rateService.saveCacheCommon(productTypeId, rates);
    return rates;
  },

  getInfoReview: async (productTypeId: number) => {
    const productTypeRate = await rateService.getInfoRateProduct(productTypeId);
    return rateService.calculateInfoReview(productTypeRate);
  },
  calculateInfoReview: async (productRate: any) => {
    const { length } = productRate;
    const initialAcc: any = { avgRate: 0, oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 0, fiveStar: 0 };
    if (!length) return initialAcc;
    const mapStar: any = { 1: 'oneStar', 2: 'twoStar', 3: 'threeStar', 4: 'fourStar', 5: 'fiveStar' };
    productRate.reduce((acc: any, curr: any) => {
      acc[mapStar[curr.star]] = (acc[mapStar[curr.star]] || 0) + 1;
      acc.avgRate += curr.star;
      return acc;
    }, initialAcc);
    initialAcc.avgRate = Number((initialAcc.avgRate / length).toFixed(2));
    return initialAcc;
  },

  getCacheCommon: async (productTypeId: number) => {
    const cachedRate = await redis.hget('rate_product_type', productTypeId.toString());
    return cachedRate ? JSON.parse(cachedRate) : [];
  },

  saveCacheCommon: async (productTypeId: number, rates: any[]) => {
    await redis.hset('rate_product_type', productTypeId.toString(), JSON.stringify(rates));
  },

  groupRateSupport: (acc: any, curr: any, key: string, id: number) => {
    const keyGroup = acc[key][id] || { countRate: 0, totalStar: 0, avgRate: 0, rates: [] };
    keyGroup.countRate += 1;
    keyGroup.totalStar += curr.star;
    keyGroup.rates.push(curr);
    keyGroup.avgRate = keyGroup.totalStar / keyGroup.countRate;
    acc[key][id] = keyGroup;
    return acc;
  },

  refreshCache: async () => {
    try {
      const rateAll = await rateService.getRateCommon();
      if (rateAll.length <= 0) return [];
      // group by
      const groupRate = rateAll.reduce((acc: any, curr: any) => {
        if (curr.productTypeId) {
          rateService.groupRateSupport(acc, curr, 'rateProductType', curr.productTypeId);
        }
        if (curr.storeId) {
          rateService.groupRateSupport(acc, curr, 'rateStore', curr.storeId);
        }
        return acc;
      }, { rateProductType: {}, rateStore: {} })

      const { rateProductType, rateStore } = groupRate;
      const pipeline = redis.pipeline();
      for (const [key, value] of Object.entries(rateProductType) as any) {
        pipeline.hset('rate_product_type', key, JSON.stringify(value.rates));
      }
      await Promise.all([
        rateService.updateStoreCache(rateStore),
        rateService.updateProductTypeCache(rateProductType),
        pipeline.exec()
      ]);
      return true;
    } catch (error: any) {
      console.log('🚀 ~ refreshCache: ~ error:', error);
      return false;
    }
  },

  updateStoreCache: async (ratesByStoreId: any) => {
    if (!Object.keys(ratesByStoreId).length) return [];
    const storeIds = Object.keys(ratesByStoreId).map(Number).filter(id => id !== null);
    const existStores = await prismaClient.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true }
    });
    if (!existStores.length) return [];
    const updatePromises = existStores
      .map((store) => ratesByStoreId[store.id] && {
        where: { id: store.id },
        data: { avgRate: ratesByStoreId[store.id].avgRate, countRate: ratesByStoreId[store.id].countRate },
      }).filter(Boolean)
      .map((update) => prismaClient.store.update(update));
    await Promise.all(updatePromises);
    return true;
  },

  updateProductTypeCache: async (ratesByProductType: any) => {
    if (!Object.keys(ratesByProductType).length) return [];
    const productTypeIds = Object.keys(ratesByProductType).map(Number).filter(id => id !== null);
    const existProductTypes = await prismaClient.productType.findMany({
      where: { id: { in: productTypeIds } }, select: { id: true }
    });
    if (!existProductTypes.length) return [];
    const updatePromises = existProductTypes
      .map((productType) => ratesByProductType[productType.id] && {
        where: { id: productType.id },
        data: { avgRate: ratesByProductType[productType.id].avgRate, countRate: ratesByProductType[productType.id].countRate },
      }).filter(Boolean)
      .map((update) => prismaClient.productType.update(update));
    await Promise.all(updatePromises);
    return true;
  },

  getListRateByShop: async (
    query: any,
    skip: number = 0,
    limit: number = 10,
    sort: string = '[{ "createdAt": "desc" }]'
  ) => {
    try {
      let orderBy: any[] = [];
      try {
        if (typeof sort === 'string') {
          const parsedSort = JSON.parse(sort) as Array<Record<string, string>>;
          orderBy = parsedSort.map(obj => {
            const [key, value] = Object.entries(obj)[0];
            return { [key]: value };
          });
        } else {
          orderBy = [{ createdAt: 'desc' }];
        }
      } catch (error) {
        orderBy = [{ createdAt: 'desc' }];
      }

      const { productName, ...restQuery } = query;
      const whereCondition = {
        ...restQuery,
        ...(productName ? {
          productInfo: {
            name: {
              contains: productName,
              mode: 'insensitive'
            }
          }
        } : {})
      };

      const [ratesWithProductInfo, total, starCounts] = await Promise.all([
        prismaClient.rate.findMany({
          where: whereCondition,
          include: {
            productInfo: {
              select: {
                id: true,
                name: true,
                images: true,
              }
            }
          },
          skip,
          take: limit,
          orderBy
        }),
        prismaClient.rate.count({ where: whereCondition }),
        prismaClient.rate.groupBy({
          by: ['star'],
          where: { storeId: query.storeId },
          _count: {
            star: true
          }
        })
      ]);

      const starStats = {
        oneStar: 0,
        twoStar: 0,
        threeStar: 0,
        fourStar: 0,
        fiveStar: 0
      };

      starCounts.forEach(item => {
        switch (item.star) {
          case 1:
            starStats.oneStar = item._count.star;
            break;
          case 2:
            starStats.twoStar = item._count.star;
            break;
          case 3:
            starStats.threeStar = item._count.star;
            break;
          case 4:
            starStats.fourStar = item._count.star;
            break;
          case 5:
            starStats.fiveStar = item._count.star;
            break;
        }
      });

      const totalStars = starCounts.reduce((acc, curr) => acc + (curr.star * curr._count.star), 0);
      const totalRatings = starCounts.reduce((acc, curr) => acc + curr._count.star, 0);
      const averageRating = totalRatings > 0 ? Number((totalStars / totalRatings).toFixed(1)) : 0;

      return { 
        code: 0,
        data: ratesWithProductInfo,
        count: total,
        statistics: {
          ...starStats,
          averageRating,
          totalRatings
        }
      };
    } catch (error) {
      console.error('Error in getListRateByShop:', error);
      throw new Error('Failed to get list rate by shop');
    }
  },
};
export default rateService;
