import { Block, Prisma, productType } from '@prisma/client';
import Store from '@src/services/store.service';
import { prismaClient } from '@src/utils/prisma';
import ono from '@jsdevtools/ono';
import localCache from '../utils/localCache';
import cryptUtils from '@src/utils/crypt';
import redis from '../utils/redis';
import Category from '@src/services/category.service';
import { Repository, Schema } from 'redis-om';
import redisClientOm from '../utils/redisOm';
import ConfigSystem from '@src/config/config';
import Item from '@src/services/item.service';
import commonUtil from '@src/utils/common';
import BlockService from './Block.service';
import flashSaleProductService from './flashSaleProduct.service';
import rateService from './rate.service';
import productHelper from '../helpers/product.helper';
import { ProductTypeElasticsearch } from '../types/product.type';
import Conf from '@src/services/conf';

type ProductTypeEntityRedisOm = {
  id: number;
  ids: string[];
  name: string;
  rate: any;
  rateBurn: any;
  categoryId: number;
  categoryIds: string[];
  categoryName: string;
  categoryNameEn: string;
  subCategoryId: number;
  subCategoryIds: string[];
  subCategoryName: string;
  payment: string;
  hotSequence: number;
  storeId: number;
  storeName: string;
  paymentCash: number;
  isHot: number;
  type: string;
  avgRate: number;
  total: number;
  purchased: number;
  fullProductTypeInfoRef: string;
  itemId: number;
  tags: string[];
  randomNumber: number;
  translations: string[];

  categoryStoreId: number;
  categoryStoreIds: string[];
  categoryStoreName: string;
  brandId: number;
  brandIds: string[];
  brandName: string;
};

interface AttributeProduct {
  f0: number; // id
  f1: string; // mexchangeId
  f2: string; // name
  f3: string; // type
}

export const productTypeService = {
  addSearchHistory: async (
    customerId: number,
    keyword: string
  ): Promise<boolean> => {
    try {
      const historyKey = `search_histories:${customerId}`;
      const isExist = await redis.lpos(historyKey, keyword);
      if (isExist === null) {
        await redis.rpush(historyKey, keyword);
      } else {
        const multi = redis.multi();
        multi.lrem(historyKey, 0, keyword);
        multi.rpush(historyKey, keyword);
        await multi.exec();
      }
      return true;
    } catch (error) {
      console.log(error);
      throw new Error('e_add_search_history');
    }
  },

  beforeCreate: async (inst: productType) => {
    if (Array.isArray(inst.tags)) {
      const storeInfo = await Store.getStoreInfoById(inst.storeId);
      inst.tags = [storeInfo.name, inst.name];
    }
    return inst;
  },

  beforeUpdate: async (inst: productType) => {
    try {
    } catch (err) {
      console.error('🚀 ~ beforeUpdate: ~ err:', err);
    }
    return inst;
  },

  getProductTypeInfoKey: (productTypeId: number) => {
    return `product_type_info_${productTypeId}`;
  },
  getProductTypeInfoKeyV2: (productTypeId: number, storeId: number) => {
    return `product_type_info_${productTypeId}_${storeId}`;
  },
  getProductTypeListKey: () => {
    return `product_type_list`;
  },
  getCategoryProductTypeKey: (categoryId: number) => {
    return `category_product_type_${categoryId}`;
  },
  getFullProductTypeInfo: async (productTypeId: number) => {
    try {
      let rs = localCache.get(
        productTypeService.getProductTypeInfoKey(productTypeId)
      );
      if (rs) return rs;
      rs = await productTypeService.getProductTypeInfoFromRedis(productTypeId);
      localCache.set(
        productTypeService.getProductTypeInfoKey(productTypeId),
        rs,
        cryptUtils.randomCacheTime()
      );
      return rs;
    } catch (error: any) {
      console.log(error);
      throw ono({
        code: 'e_product_not_found',
        message: error.message,
      });
    }
  },

  getProductTypeInfoFromRedis: async (productTypeId: number) => {
    let rs: any = await redis.get(
      productTypeService.getProductTypeInfoKey(productTypeId)
    );
    if (rs) {
      return JSON.parse(rs);
    }
    rs = await productTypeService.getProductTypeInfoFromDb(productTypeId);
    await redis.set(
      productTypeService.getProductTypeInfoKey(productTypeId),
      JSON.stringify(rs),
      'EX',
      cryptUtils.getCacheTime()
    );
    return rs;
  },
  getProductTypeInfoFromDb: async (productTypeId: number) => {
    const productTypeInfo: any = await prismaClient.productType.findUnique({
      where: {
        id: productTypeId,
      },
    });
    if (!productTypeInfo || productTypeInfo.isActive !== true) {
      throw ono('e_cannot_find_product_type_info');
    }
    const productInfos = await prismaClient.product.findMany({
      where: {
        isActive: true,
        productTypeId,
        isDelete: false,
      },
    });
    const productIds = productInfos.map((i) => i.id);
    const productTypeAttributeInfos =
      await prismaClient.productTypeAttribute.findMany({
        where: {
          productTypeId,
        },
      });
    const attributeInfos = await prismaClient.attribute.findMany({
      where: {
        id: {
          in: productTypeAttributeInfos.map((e) => e.attributeId),
        },
      },
    });
    const attributeValueInfos = await prismaClient.attributevalue.findMany({
      where: {
        attributeId: {
          in: attributeInfos.map((e) => e.id),
        },
        productTypeId,
      },
    });
    if (!productInfos.length) {
      throw ono({
        code: 'e_cannot_find_product_info',
        message: `Sản phẩm ${productTypeInfo.name} không còn khả dụng, quý khách vui lòng xem lại giỏ hàng`,
      });
    }
    const productAttributeValueInfos =
      await prismaClient.productattributevalue.findMany({
        where: {
          productId: {
            in: productIds,
          },
          attributeValueId: {
            in: attributeValueInfos.map((e) => e.id),
          },
        },
      });

    let storeInfo;
    if (productTypeInfo.storeId) {
      storeInfo = await Store.getStoreInfoById(productTypeInfo.storeId);
    }
    let categoryInfo;
    if (productTypeInfo.categoryId) {
      categoryInfo = await Category.getCategoryInfo(productTypeInfo.categoryId);
    }

    const productTypePushData = await rateService.getInfoReview(
      productTypeInfo.id
    );

    const { oneStar, twoStar, threeStar, fourStar, fiveStar } =
      productTypePushData;

    const itemInfos = await prismaClient.item.findMany({
      where: {
        id: {
          in: productInfos.map((p) => p.itemId),
        },
      },
      select: {
        id: true,
        total: true,
        purchased: true,
      },
    });

    const productsWithTotal = productInfos.map((product) => {
      const itemInfo = itemInfos.find((item) => item.id === product.itemId);
      return {
        ...product,
        total: itemInfo?.total || 0,
        purchased: itemInfo?.purchased || 0,
      };
    });

    const rs = {
      productTypeInfo: {
        ...productTypeInfo,
        ...productTypePushData,
        oneStar: oneStar || 0,
        twoStar: twoStar || 0,
        threeStar: threeStar || 0,
        fourStar: fourStar || 0,
        fiveStar: fiveStar || 0,
      },
      productInfos: productsWithTotal,
      storeInfo,
      categoryInfo,
      attributeValueInfos,
      attributeInfos,
      productAttributeValueInfos,
      productTypeAttributeInfos,
    };
    return rs;
  },
  getAttrByProductIds: async (producIds: any) => {
    try {
      if (producIds.length > 0) {
        const result = await prismaClient.$queryRaw<AttributeProduct[]>`
          SELECT 
            p.id as f0,
            p."mexchangeId" as f1, 
            av.name as f2,
            CASE 
              WHEN a.name = 'unit' THEN 'Đơn vị' 
              ELSE a.name 
            END as f3
          FROM 
            product p 
            INNER JOIN productattributevalue pav ON p.id = pav."productId"
            INNER JOIN attributevalue av ON pav."attributeValueId" = av.id
            INNER JOIN attribute a ON a.id = av."attributeId"
          WHERE 
            p.id IN (${Prisma.join(producIds)})
        `;
        return result.map((item) => ({
          id: item.f0,
          mexchangeId: item.f1,
          name: item.f2,
          type: item.f3,
        }));
      }
      return [];
    } catch (err) {
      console.log('🚀 ~ getAttrByProductIds ~ err:', err);
    }
    return [];
  },

  // --------------------------- Redis Om ---------------------------
  getKeyIndexRedisearchProductType: () => {
    return `${process.env.REDIS_PREFIX}:vnairline_index_product_info`;
  },

  async initIndexSearchType() {
    try {
      const repositoryproductType = this.getRepositoryRedisOm();
      try {
        await repositoryproductType.dropIndex();
      } catch (err) {
        console.log('🚀 ~ initIndexSearchType ~ err:', err);
      }
      await repositoryproductType.createIndex();
    } catch (error) {
      console.log('🚀 ~ initIndexSearchType ~ error:', error);
    }
  },

  getRepositoryRedisOm() {
    const productRepository = new Repository(
      this.getSchemaRedisOm(),
      redisClientOm
    );
    return productRepository;
  },

  getSchemaRedisOm() {
    const productSchema = new Schema(
      `${ConfigSystem.REDISEARCH_CONFIG.prefix}:producttype_redisom`,
      {
        id: { type: 'number', sortable: true },
        ids: { type: 'string[]' },
        name: { type: 'text' },
        categoryId: { type: 'number' },
        partnerId: { type: 'number' },
        categoryIds: { type: 'string[]' },
        categoryName: { type: 'text' },
        categoryNameEn: { type: 'text' },
        subCategoryId: { type: 'number' },
        subCategoryIds: { type: 'string[]' },
        subCategoryName: { type: 'text' },
        payment: { type: 'string' },
        hotSequence: { type: 'number', sortable: true },
        storeId: { type: 'number' },
        storeName: { type: 'text' },
        paymentCash: { type: 'number', sortable: true },
        isHot: { type: 'number' },
        type: { type: 'string' },
        avgRate: { type: 'number', sortable: true },
        total: { type: 'number', sortable: true },
        purchased: { type: 'number', sortable: true },
        fullProductTypeInfoRef: { type: 'text' },
        itemId: { type: 'number' },
        tags: { type: 'string[]' },
        randomNumber: { type: 'number', sortable: true },
        translations: { type: 'string[]' },
        categoryStoreId: { type: 'number' },
        categoryStoreIds: { type: 'string[]' },
        categoryStoreName: { type: 'text' },
        brandId: { type: 'number' },
        brandIds: { type: 'string[]' },
        brandName: { type: 'text' },
      },
      {
        indexName: `${process.env.REDIS_PREFIX}:producttype_search`,
        dataStructure: 'JSON',
        useStopWords: 'OFF',
      }
    );
    return productSchema;
  },

  getLastestTimeCronUpdateCacheProduct: () => {
    const time = Conf.get('LASTEST_TIME_CRON_UPDATE_CACHE_PRODUCT', 0);
    return time;
  },

  updateLastestTimeCronUpdateCacheProduct: async (time: number) => {
    await prismaClient.conf.updateMany({
      where: {
        name: 'LASTEST_TIME_CRON_UPDATE_CACHE_PRODUCT',
      },
      data: {
        val: time.toString(),
      },
    });
  },

  refreshListProductTypeForRedisOm: async () => {
    try {
      const repositoryProductType = productTypeService.getRepositoryRedisOm();
      const listKeyProductType = await redisClientOm.keys(
        `*${process.env.REDIS_PREFIX}:producttype_redisom*`
      );
      if (listKeyProductType.length > 0) {
        await redisClientOm.del(listKeyProductType);
      }
      const productTypesInDB = await prismaClient.productType.findMany({
        where: {
          isApprove: true,
          isActive: true,
        },
        omit: {
          description: true,
          instruction: true,
          tags: true,
        },
      });
      const storeIdsUnique = [
        ...new Set(productTypesInDB.map((e) => e.storeId)),
      ];
      if (storeIdsUnique.length == 0) {
        return;
      }
      const countDepotStore = await prismaClient.$queryRaw<
        {
          storeId: number;
          count: number;
        }[]
      >`
        SELECT
        	"storeId",
        	COUNT( "storeId" ) 
        FROM
        	depot 
        WHERE
        	"storeId" IN (${Prisma.join(storeIdsUnique)}) 
        GROUP BY
        	"storeId"      
      `;
      const productTypes = productTypesInDB.filter((e) => {
        const countDepot = countDepotStore.find((c) => c.storeId === e.storeId);
        return countDepot?.count && countDepot?.count > 0;
      });
      if (productTypes.length > 0) {
        const productsElasticsearch: ProductTypeElasticsearch[] = [];
        const productTypeIds: number[] = productTypes.map((e) => e.id);
        const flashSaleProductTypesInRedisOm =
          await flashSaleProductService.getFlashSaleInfoOfProductTypeIds(
            productTypeIds
          );
        const itemIds: number[] = [];
        productTypes.forEach((e) => {
          itemIds.push(Number(e.itemId || 0));
        });
        const [stores, allCategorys, itemInfos, brands, categoryStoreInfos] =
          await Promise.all([
            prismaClient.store.findMany({
              where: {
                id: {
                  in: productTypes.map((i) => i.storeId),
                },
              },
              select: {
                id: true,
                name: true,
                logo: true,
                provinceId: true,
              },
            }),
            prismaClient.category.findMany({
              where: {
                isActive: true,
                type: 'product',
              },
            }),
            Item.getListItems(itemIds),
            prismaClient.brand.findMany({
              where: {
                id: {
                  in: productTypes.map((i) => i.brandId || 0),
                },
              },
            }),
            prismaClient.categoryStore.findMany({
              where: {
                id: {
                  in: productTypes.map((i) => i.categoryStoreId || 0),
                },
              },
            }),
          ]);

        for (let i = 0; i < productTypes.length; i++) {
          const flashSale = flashSaleProductTypesInRedisOm.find(
            (e) => e.productTypeId === productTypeIds[i]
          );
          const dataInsertToRedisOm: ProductTypeEntityRedisOm = {
            id: 0,
            ids: [],
            rate: {},
            rateBurn: {},
            name: '',
            categoryId: 0,
            categoryName: '',
            categoryNameEn: '',
            subCategoryId: 0,
            subCategoryName: '',
            payment: '',
            hotSequence: 0,
            paymentCash: 0,
            isHot: 0,
            type: '',
            avgRate: 0,
            purchased: 0,
            categoryIds: [],
            total: -1,
            itemId: productTypes[i].itemId || 0,
            tags: [],
            fullProductTypeInfoRef: '',
            storeId: 0,
            storeName: '',
            randomNumber: Math.floor(Math.random() * 1000000),
            translations: [],
            categoryStoreId: 0,
            categoryStoreIds: [],
            categoryStoreName: '',
            subCategoryIds: [],
            brandId: 0,
            brandIds: [],
            brandName: '',
          };
          const productType: any = productTypes[i];
          const storeInfo = stores.find((e) => e.id === productType.storeId);
          const brandInfo = brands.find((e) => e.id === productType.brandId);
          const categoryStoreInfo = categoryStoreInfos.find(
            (e) => e.id === productType.categoryStoreId
          );
          const itemInfo = itemInfos.find(
            (e: any) => e.id === productType.itemId
          );
          let categoryName = '',
            categoryNameEn = '';
          const category = allCategorys.find(
            (e) => e.id === productType.categoryId
          );
          const subCategory = allCategorys.find(
            (e) => e.id === productType.subCategoryId
          );

          dataInsertToRedisOm.id = productType.id;
          dataInsertToRedisOm.ids = [String(productType.id)];
          dataInsertToRedisOm.name = productType.name
            ? commonUtil.removeAccentsAndReplaceSpaces(
                productType.name,
                'lowercase'
              )
            : '';
          dataInsertToRedisOm.categoryId = productType.categoryId || 0;
          dataInsertToRedisOm.categoryIds = [String(productType.categoryId)];
          dataInsertToRedisOm.categoryName = categoryName;
          dataInsertToRedisOm.categoryNameEn = categoryNameEn;
          dataInsertToRedisOm.subCategoryId = productType.subCategoryId || 0;
          dataInsertToRedisOm.subCategoryIds = [
            String(productType.subCategoryId),
          ];
          dataInsertToRedisOm.subCategoryName = subCategory?.name
            ? commonUtil.removeAccentsAndReplaceSpaces(
                subCategory?.name,
                'lowercase'
              )
            : '';
          dataInsertToRedisOm.payment = productType.payment || '';
          dataInsertToRedisOm.hotSequence = productType.hotSequence || 0;
          dataInsertToRedisOm.storeId = productType.storeId;
          dataInsertToRedisOm.storeName = storeInfo?.name
            ? commonUtil.removeAccentsAndReplaceSpaces(
                storeInfo?.name,
                'lowercase'
              )
            : '';
          dataInsertToRedisOm.paymentCash = productType.paymentCash || 0;
          if (flashSale) {
            dataInsertToRedisOm.paymentCash = flashSale.salePrice;
          }
          dataInsertToRedisOm.isHot = productType.isHot ? 1 : 0;
          dataInsertToRedisOm.avgRate = itemInfo?.avgRate || 0;
          dataInsertToRedisOm.purchased = itemInfo?.purchased || 0;
          dataInsertToRedisOm.total = -1;
          dataInsertToRedisOm.brandId = brandInfo?.id || 0;
          dataInsertToRedisOm.brandIds = [String(brandInfo?.id)];
          dataInsertToRedisOm.brandName = brandInfo?.name || '';
          dataInsertToRedisOm.categoryStoreId = categoryStoreInfo?.id || 0;
          dataInsertToRedisOm.categoryStoreIds = [
            String(categoryStoreInfo?.id),
          ];
          dataInsertToRedisOm.categoryStoreName = categoryStoreInfo?.name || '';
          //@ts-ignore
          dataInsertToRedisOm.tags = productType.tags || [];
          dataInsertToRedisOm.fullProductTypeInfoRef = JSON.stringify({
            ...productType,
            storeName: storeInfo?.name || '',
            storeLogo: storeInfo?.logo || null,
            categoryName: category?.name || '',
            subCategoryName: subCategory?.name || '',
            total: dataInsertToRedisOm.total,
            purchased: dataInsertToRedisOm.purchased,
            provinceId: storeInfo?.provinceId || null,
            logoStore: storeInfo?.logo || null,
            categoryStoreId: productType.categoryStoreId || 0,
          });
          productsElasticsearch.push({
            id: productType.id,
            name: productType.name,
            categoryName: category?.name || '',
            categoryNameEn: dataInsertToRedisOm.categoryNameEn || '',
            subCategoryName: subCategory?.name || '',
            tags: productType.tags || [],
            translations: productType.translations || [],
            storeName: storeInfo?.name || '',
            brandName: brandInfo?.name || '',
            categoryStoreName: categoryStoreInfo?.name || '',
          });
          if (
            dataInsertToRedisOm.total > 0 &&
            dataInsertToRedisOm.total - dataInsertToRedisOm.purchased <= 0
          ) {
            continue;
          }
          await repositoryProductType.save(
            String(productType.id),
            dataInsertToRedisOm
          );
        }
        await productHelper.indexDocumentsProductType(productsElasticsearch);

        await productTypeService.updateLastestTimeCronUpdateCacheProduct(
          new Date().getTime()
        );
      }
    } catch (err) {
      console.log('🚀 ~ refreshListproductTypeForRedisOm: ~ err:', err);
    }
  },

  bootstrap: async () => {
    await productTypeService.initIndexSearchType();
    await productTypeService.initIndexSearchProductInElasticsearch();
    setTimeout(() => {
      productTypeService
        .refreshListProductTypeForRedisOm()
        .then(() => {})
        .catch((err) => {
          console.log('🚀 ~ bootstrap ~ err:', err);
        });
    }, 10000);
  },

  runCronjob5: async () => {
    try {
      await productTypeService.refreshListProductTypeForRedisOm();
    } catch (err) {
      console.log('🚀 ~ runCronjob5: ~ err:', err);
    }
  },

  async initIndexSearchProductInElasticsearch() {
    try {
      redis
        .set(
          'INIT_INDEX_SEARCH_PRODUCT_ELASTICSEARCH',
          'LOCK',
          'EX',
          24 * 60 * 60,
          'NX'
        )
        .then(async (result) => {
          if (result === 'OK') {
            await productHelper.createIndexProductInElasticsearch();
          } else {
            console.log('Lock init index search voucher in elasticsearch');
          }
        })
        .catch((err) => {
          console.log('🚀 ~ initIndexSearchVoucherInElasticsearch ~ err:', err);
        });
    } catch (error) {
      console.log('🚀 ~ initIndexSearchVoucherInElasticsearch ~ error:', error);
    }
  },

  // --------------------------- Block ---------------------------
  getBlockWithProductTypeV2: async (input: {
    customerId?: number;
    blockId?: number;
    isIntegration?: boolean;
    latitude?: number;
    longitude?: number;
    skip: number;
    limit: number;
    sort?: string;
    typeSort?: 'ASC' | 'DESC';
    distance?: number;
  }) => {
    const {
      blockId,
      isIntegration,
      skip,
      limit,
      sort,
      typeSort,
      latitude,
      longitude,
      distance,
    } = input;
    const blocks = await BlockService.getBlocks(blockId, isIntegration);
    const process = blocks.map((block) =>
      productTypeService.getListProductTypeByBlockInfo({
        blockInfo: block,
        skip,
        limit,
        sort,
        typeSort,
        latitude,
        longitude,
        distance,
      })
    );
    const results = await Promise.all(process);
    return results;
  },

  getListProductTypeByBlockInfo: async (input: {
    blockInfo: Block;
    skip: number;
    limit: number;
    sort?: string;
    typeSort?: 'ASC' | 'DESC';
    latitude?: number;
    longitude?: number;
    distance?: number;
  }) => {
    const {
      blockInfo,
      skip,
      limit,
      sort,
      typeSort,
      latitude,
      longitude,
      distance,
    } = input;
    //@ts-ignore
    const uniqueIds: number[] = blockInfo.productIds;
    if (uniqueIds.length === 0) {
      return { ...blockInfo, products: [] };
    }
    const repositoryRedisOMProductType =
      productTypeService.getRepositoryRedisOm();
    let productsQuery: any = repositoryRedisOMProductType
      .search()
      .where('ids')
      .containOneOf(...uniqueIds.map((id) => id.toString()));

    if (sort === 'sell') {
      productsQuery = productsQuery.sortBy('purchased', typeSort || 'DESC');
    }

    const productsInRedisOm = await productsQuery.return.all();

    const products = productsInRedisOm
      .map((e: any) => {
        try {
          const productInfo = JSON.parse(e.fullProductTypeInfoRef as any);
          return productInfo;
        } catch (error) {
          return e;
        }
      })
      .filter((product: any) => uniqueIds.includes(product.id));

    let paginatedProducts = products
      .sort((a: any, b: any) => {
        return uniqueIds.indexOf(a.id) - uniqueIds.indexOf(b.id);
      })
      .slice(skip, skip + limit);

    if (sort === 'location' && latitude && longitude) {
      // Lấy danh sách storeId từ các sản phẩm
      const storeIds = paginatedProducts.map((product: any) => product.storeId);

      // Gọi getStoreList với các storeId cụ thể
      const stores = await Store.getStoreListV2(
        latitude,
        longitude,
        distance || 10,
        storeIds
      );

      // Tạo map để lưu trữ khoảng cách của từng cửa hàng
      const storeDistanceMap = new Map(
        stores.map((store) => [store.id, store.distance])
      );

      // Thêm thông tin khoảng cách vào sản phẩm và sắp xếp
      paginatedProducts = paginatedProducts
        .map((product: any) => ({
          ...product,
          distance: storeDistanceMap.get(product.storeId) || Infinity,
        }))
        .sort((a: any, b: any) => a.distance - b.distance);
    }

    return {
      ...blockInfo,
      products: paginatedProducts,
      length: products.length,
    };
  },
};
export default productTypeService;
