import { prismaClient } from '@src/utils/prisma';
import redis from '../utils/redis';
import Conf from '@src/services/conf';

export type categoryCache = {
  id: number | null;
  name: string | null;
  parentId: number | null;
  image: string | null;
  type: string | null;
  hotSequence: number | 0;
  isHot: boolean | false;
  product_count: number | 0;
  children?: categoryCache[] | [];
};

export const categoryService = {
  getCategoryKey: () => {
    return `category`;
  },

  getCategoryInfo: async (categoryId: number) => {
    let categoryInfo: any = await redis.get(`category_info_${categoryId}`);
    if (!categoryInfo) {
      categoryInfo = await prismaClient.category.findUnique({
        where: {
          id: categoryId,
        },
      });
      categoryInfo = JSON.stringify(categoryInfo);
      await redis.set(`category_info_${categoryId}`, categoryInfo, 'EX', 300);
    }
    return JSON.parse(categoryInfo);
  },

  async getCategoryList(type: string) {
    let categoryList: any = await redis.get(this.getCategoryKey());
    if (!categoryList) return;
    if (categoryList) {
      categoryList = JSON.parse(categoryList);
    }
    if (type) {
      categoryList = categoryList.filter((categoryInfo: any) => {
        if (categoryInfo && categoryInfo.type === type) {
          return true;
        } else {
          return false;
        }
      });
    }
    return categoryList;
  },

  bootstrap: async () => {
    setTimeout(async () => {
      await categoryService.refreshCategory();
    }, 5000);
  },

  runCronjob5: async () => {
    await categoryService.refreshCategory();
  },

  refreshCategory: async () => {
    const categories: categoryCache[] =
      await prismaClient.$queryRaw`WITH RECURSIVE category_hierarchy AS (
        SELECT 
          c.id, c.name, c.image, c."isHot", c."hotSequence", c."parentId",
          COUNT(DISTINCT CASE 
            WHEN p.id IS NOT NULL AND (p."categoryId" = c.id OR p."subCategoryId" = c.id) 
            THEN p.id 
          END) as product_count
        FROM category c 
        LEFT JOIN producttype p ON (p."categoryId" = c.id OR p."subCategoryId" = c.id)
            AND p."isActive" = true
            AND p."isApprove" = true
        WHERE c."isActive" = true
        GROUP BY c.id, c.name, c.image, c."isHot", c."hotSequence", c."parentId"
      )
      SELECT 
        id, name, image, "isHot", "hotSequence", "parentId",
        product_count
      FROM category_hierarchy
      ORDER BY "hotSequence"`;
    if (categories.length === 0) {
      return;
    }
    await redis.set('categories', JSON.stringify(categories));
    const categoriesHot = categories
      .filter((category: any) => category.isHot)
      .sort((a: any, b: any) => (a.hotSequence ?? 0) - (b.hotSequence ?? 0));
    if (categoriesHot.length > 0) {
      await redis.set('categories_hot', JSON.stringify(categoriesHot));
    }
  },

  getListCategory: async ({
    skip,
    limit,
    isHot,
    isParent,
    categoryId,
  }: {
    skip: number;
    limit: number;
    isHot?: boolean;
    isParent?: boolean;
    categoryId?: number;
  }) => {
    let total = 0;
    if (isHot) {
      const categoriesHot = await redis.get('categories_hot');
      if (categoriesHot) {
        if (isParent) {
          const categoriesParent = JSON.parse(categoriesHot).filter(
            (category: any) => category.parentId === 0
          );
          total = categoriesParent.length;
          return {
            data: categoriesParent.slice(skip, limit),
            total,
          };
        }
        if (categoryId) {
          const categoriesParent = JSON.parse(categoriesHot).filter(
            (category: any) => category.parentId === categoryId
          );
          total = categoriesParent.length;
          return {
            data: categoriesParent.slice(skip, limit),
            total,
          };
        }
        total = JSON.parse(categoriesHot).length;
        return {
          data: JSON.parse(categoriesHot).slice(skip, limit),
          total,
        };
      }
      return {
        data: [],
        total,
      };
    }
    const categories = await redis.get('categories');
    if (categories) {
      if (isParent) {
        const categoriesParent = JSON.parse(categories).filter(
          (category: any) => category.parentId === 0
        );
        total = categoriesParent.length;
        return {
          data: categoriesParent.slice(skip, limit),
          total,
        };
      }
      if (categoryId) {
        const categoriesParent = JSON.parse(categories).filter(
          (category: any) => category.parentId === categoryId
        );
        total = categoriesParent.length;
        return {
          data: categoriesParent.slice(skip, limit),
          total,
        };
      }
      total = JSON.parse(categories).length;
      return {
        data: JSON.parse(categories).slice(skip, limit),
        total,
      };
    }
    return {
      data: [],
      total,
    };
  },

  getCategoriesOfStore: async (storeId: number) => {
    const key = `categories_store_${storeId}`;
    const cacheTime = Conf.get('CACHE_TIME_CATEGORY_STORE', 30 * 60);
    const categoriesStore = await redis.get(key);
    if (categoriesStore) {
      return JSON.parse(categoriesStore);
    } else {
      const categoriesInfo: categoryCache[] = await prismaClient.$queryRaw`
      WITH RECURSIVE category_hierarchy AS (
        SELECT 
          c.id, c.name, c.image, c."isHot", c."hotSequence", c."parentId",
          COUNT(DISTINCT CASE 
            WHEN p.id IS NOT NULL AND (p."categoryId" = c.id OR p."subCategoryId" = c.id) 
            THEN p.id 
          END) as product_count
        FROM category c 
        LEFT JOIN producttype p ON (p."categoryId" = c.id OR p."subCategoryId" = c.id)
						AND p."storeId" = ${storeId}
            AND p."isActive" = true
            AND p."isApprove" = true
        WHERE c."isActive" = true
        GROUP BY c.id, c.name, c.image, c."isHot", c."hotSequence", c."parentId"
      )
      SELECT 
        id, name, image, "isHot", "hotSequence", "parentId",
        product_count
      FROM category_hierarchy
      ORDER BY "hotSequence"`;

      const groupCategoryInfoFilter = buildNestedCategories(categoriesInfo);
      if (groupCategoryInfoFilter.length > 0) {
        await redis.set(
          key,
          JSON.stringify(groupCategoryInfoFilter),
          'EX',
          cacheTime
        );
      }
      return groupCategoryInfoFilter;
    }
  },
};

export default categoryService;

const buildNestedCategories = (
  categories: categoryCache[],
  parentId: number | null = 0
): categoryCache[] => {
  const result: categoryCache[] = [];
  for (const category of categories) {
    if (category.parentId === parentId) {
      const children = buildNestedCategories(categories, category.id);
      result.push({
        ...category,
        children: children.length ? children : [],
      });
    }
  }
  return result;
};
