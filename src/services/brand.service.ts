import { prismaClient } from "@root/src/utils/prisma";
import redis from "@root/src/utils/redis";
import categoryService from "./category.service";

export type brandCache = {
  id: number | null;
  name: string | null;
  image: string | null;
  hotSequence: number | 0;
  isHot: boolean | false;
  product_count: number | 0;
};
const prefix = "brands-nacare";

export const brandService = {
  refreshBrandByCategory: async () => {
    let { data: categories } = await categoryService.getListCategory({
      skip: 0,
      limit: 100000,
    });

    await Promise.all(
      categories.map(async (category: any) => {
        const brands: brandCache[] = await prismaClient.$queryRaw`
          SELECT b.id, b.name, b.image, b."isHot", b."hotSequence", COUNT(DISTINCT p.id) as product_count
          FROM brand b 
          LEFT JOIN producttype p ON b.id = p."brandId" and p."isActive"=true and p."isApprove" = TRUE
          INNER JOIN category c on (c.id = p."categoryId" or c.id = p."subCategoryId") and c."isActive" = TRUE
          WHERE b."isActive" = true and c.id = ${category.id} 
          GROUP BY b.id 
          ORDER BY b."hotSequence"`;
        return redis.set(
          `${prefix}:category:${category.id}`,
          brands.length > 0 ? JSON.stringify(brands) : "[]",
        );
      }),
    );
  },

  refreshBrand: async () => {
    const brands: brandCache[] = await prismaClient.$queryRaw`
    SELECT b.id,b.name,b.image,b."isHot",b."hotSequence", COUNT(DISTINCT p.id) as product_count
    FROM brand b LEFT JOIN producttype p ON b.id = p."brandId" and p."isActive"=true and p."isApprove" = TRUE
    WHERE b."isActive" = true GROUP BY b.id ORDER BY b."hotSequence"`;

    if (brands.length === 0) {
      return;
    }
    const brandsAll = [[`${prefix}:all`, JSON.stringify(brands)]];
    const brandsHot = brands
      .filter((brand: any) => brand.isHot)
      .sort((a: any, b: any) => (a.hotSequence ?? 0) - (b.hotSequence ?? 0));
    if (brandsHot.length > 0) {
      brandsAll.push([`${prefix}:hot`, JSON.stringify(brandsHot)]);
    }
    await Promise.all(brandsAll.map(([key, value]) => redis.set(key, value)));

    try {
      await brandService.refreshBrandByCategory();
    } catch (error) {
      console.error("refresh brand by category error", error);
    }
  },

  runCronjob5: async () => {
    try {
      await brandService.refreshBrand();
    } catch (error) {
      console.error("refresh brand error", error);
    }
  },

  bootstrap: async () => {
    brandService.refreshBrand().catch((error) => {
      console.error("refresh brand error", error);
    });
  },

  getListBrand: async ({
    skip,
    limit,
    isHot,
    categoryId,
  }: {
    skip: number;
    limit: number;
    isHot?: boolean;
    categoryId?: number;
  }) => {
    let brands: string | brandCache[] | null = null;
    if (isHot) {
      brands = await redis.get(`${prefix}:hot`);
    } else if (categoryId) {
      brands = await redis.get(`${prefix}:category:${categoryId}`);
    } else {
      brands = await redis.get(`${prefix}:all`);
    }
    if (!brands) {
      return { data: [], total: 0 };
    }

    const brandsArray = JSON.parse(brands);
    return {
      data: brandsArray.slice(skip, limit),
      total: brandsArray.length,
    };
  },
};
export default brandService;
