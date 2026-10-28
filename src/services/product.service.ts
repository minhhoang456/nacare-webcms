import { prismaClient, Prisma } from '@src/utils/prisma';
import _ from 'lodash';
import redis from '../utils/redis';
import itemService from './item.service';
import Item from '@src/services/item.service';
import { ProductPaymentEnum, ProductTypePaymentEnum } from '@prisma/client';
import { productInventoryLogService } from './productInventoryLog.service';

export const productService = {
  getListProductInfosByIds: async (productIds: number[]) => {
    if (_.isEmpty(productIds)) return [];
    const rs = await prismaClient.product.findMany({
      where: {
        id: {
          in: productIds,
        },
      },
    });
    return rs;
  },

  getProductInfoById: async (productId: number) => {
    try {
      const productInfo = await prismaClient.product.findUnique({
        where: {
          id: productId,
        },
      });
      return productInfo;
    } catch (error) {
      console.log(
        "🚀 ~ file: product.service.ts:29 ~ getProductInfoById: ~ error:",
        error
      );
      return null;
    }
  },

  handleDeleteProduct: async (delProducts: any, db: any) => {
    if (delProducts.length > 0) {
      const delProductsSuccess: any = await db.product.updateMany({
        where: {
          id: { in: delProducts.map((i: any) => Number(i.id)) },
        },
        data: {
          isDelete: true,
        },
      });
      const delProdAttrValues = await db.productattributevalue.findMany({
        where: {
          productId: {
            in: delProductsSuccess.map((i: any) => i.id),
          },
        },
      });
      if (delProdAttrValues.length > 0) {
        const delAttrValues = await db.attributevalue.findMany({
          where: {
            id: {
              in: delProdAttrValues.map((i: any) => Number(i.attributeValueId)),
            },
          },
        });
        await db.productattributevalue.deleteMany({
          where: {
            id: { in: delProdAttrValues.map((i: any) => i.id) },
          },
        });
        await db.attributevalue.deleteMany({
          where: {
            id: { in: delAttrValues.map((i: any) => i.id) },
          },
        });
      }
    }
  },
  //
  initCache: async () => {
    const listProducts = await prismaClient.product.findMany({
      where: {
        isDelete: false,
      },
    });
    const pip = redis.multi();
    const keys: any = {},
      productTypeInfos: any = [],
      keysMapId: any = {};
    listProducts.forEach((product: any) => {
      productTypeInfos.push({
        type: "producttype",
        typeId: product.productTypeId,
      });
    });
    const itemsParent = await itemService.getItemIdsFromTypes(productTypeInfos);
    for (let i = 0; i < listProducts.length; i++) {
      keys[`product_item_${listProducts[i].itemId}`] = itemsParent[i];
      if (keys[`producttype_item_${itemsParent[i]}`]) {
        keys[`producttype_item_${itemsParent[i]}`].push(listProducts[i].itemId);
      } else {
        keys[`producttype_item_${itemsParent[i]}`] = [];
        keys[`producttype_item_${itemsParent[i]}`].push(listProducts[i].itemId);
      }

      keysMapId[`product_${listProducts[i].id}`] =
        listProducts[i].productTypeId;
      if (keysMapId[`producttype_${listProducts[i].productTypeId}`]) {
        keysMapId[`producttype_${listProducts[i].productTypeId}`].push(
          listProducts[i].id
        );
      } else {
        keysMapId[`producttype_${listProducts[i].productTypeId}`] = [];
        keysMapId[`producttype_${listProducts[i].productTypeId}`].push(
          listProducts[i].id
        );
      }
    }
    for (const key in keys) {
      if (key.startsWith("producttype_item_")) {
        keys[key] = JSON.stringify(keys[key]);
      }
    }
    for (const key in keysMapId) {
      if (key.startsWith("producttype_")) {
        keysMapId[key] = JSON.stringify(keysMapId[key]);
      }
    }
    pip.del(`item_map_product_producttype`, `map_id_product_producttype`);
    pip.hmset(`item_map_product_producttype`, keys);
    pip.hmset(`map_id_product_producttype`, keysMapId);
    await pip.exec();
  },

  getListSortedShops: async (lat: any, lng: any, radius: any) => {
    const rs = await redis.georadius(
      "SHOP_GPS",
      lng,
      lat,
      radius,
      "km",
      "WITHDIST",
      "WITHCOORD",
      "ASC"
    );
    const shops: any = [];
    rs.forEach((i: any) => {
      const shopInfo = JSON.parse(i[0]);
      shopInfo.distance = Number(i[1]);
      shopInfo.lat = Number(i[2][1]);
      shopInfo.long = Number(i[2][0]);
      shopInfo.shopId = shopInfo.id;
      shops.push(shopInfo);
    });
    return shops;
  },

  createNewProduct: async (inputs: {
    productTypeInfo?: any;
    categoryId?: any;
    storeInfo?: any;
    // stores?: any;
  }): Promise<{ id: number; itemId: number } | null> => {
    const {
      productTypeInfo,
      categoryId,
      storeInfo,
      // stores,
    } = inputs;

    try {
      const result = await prismaClient.$transaction(
        async (db) => {
          // Create new product type
          const productTypeData = createProductTypeData(
            productTypeInfo,
            categoryId
          );

          let totalProducts = 0;
          productTypeInfo.products?.forEach((e: any) => {
            totalProducts += e.total || 0;
          });

          const itemInfo = await Item.addItem(
            {
              total: totalProducts,
            },
            db
          );
          if (itemInfo) {
            productTypeData.itemId = itemInfo.id;
          }

          const productType = await db.productType.create({
            data: productTypeData,
          });

          // Create attributes
          const attributes = await createAttributes(
            db,
            productTypeInfo,
            categoryId,
            productType.id
          );

          // Create products
          const storeProductTypeIds = await createProducts(
            db,
            productTypeInfo,
            productType,
            storeInfo,
            // stores,
            attributes
          );

          // Update product type with store IDs
          if (storeProductTypeIds.length > 0) {
            await updateProductTypeStores(
              db,
              productType.id,
              storeProductTypeIds
            );
          }

          // Trả về thông tin về productType mới
          return { id: productType.id, itemId: productType.itemId };
        },
        {
          maxWait: 15000,
          timeout: 15000,
        }
      );

      return result;
    } catch (error) {
      console.log("Error in createNewProduct:", error);
      throw error;
    }
  },

  updateProduct: async (inputs: {
    productTypeInfo: any;
    categoryId?: number;
  }): Promise<any> => {
    const { productTypeInfo, categoryId } = inputs;

    try {
      const result = await prismaClient.$transaction(async (db) => {
        // Update product type
        const productTypeData = {
          name: productTypeInfo.name,
          description: productTypeInfo.description || '',
          images: productTypeInfo.images,
          isActive: productTypeInfo.isActive,
          isApprove: productTypeInfo.isApprove,
          thumbnail: productTypeInfo.thumbnail,
          payment: 'cash' as ProductTypePaymentEnum,
          paymentCash: productTypeInfo.paymentCash,
          originPrice: productTypeInfo.originPrice,
          partnerId: productTypeInfo.partnerId || 0,
          weight: productTypeInfo.weight,
          storeId: productTypeInfo.storeId,
          brandId: productTypeInfo.brandId || 0,
          categoryStoreId: productTypeInfo.categoryStoreId || 0,
          tags: productTypeInfo.tags || [],
          subCategoryId: productTypeInfo.subCategoryId,
          categoryId: categoryId,
          certificate: productTypeInfo.certificate || '',
        };

        const productType = await db.productType.update({
          where: { id: productTypeInfo.id },
          data: productTypeData
        });

        // Update attributes
        await updateAttributes(db, productTypeInfo, categoryId, productType.id);

        // Update products
        await updateProducts(db, productTypeInfo, productType);

        return { id: productType.id };
      });

      return result;
    } catch (error) {
      console.log('Error in updateProduct:', error);
      throw error;
    }
  },
};
export default productService;

// Helper functions
const createProductTypeData = (
  productTypeInfo: any,
  categoryId: number | undefined
): Prisma.productTypeCreateInput => {
  return {
    categoryId: categoryId ?? 0,
    subCategoryId: productTypeInfo.subCategoryId,
    name: productTypeInfo.name,
    description: productTypeInfo.description || "",
    images: productTypeInfo.images,
    isActive: productTypeInfo.isActive ?? false,
    isApprove: productTypeInfo.isApprove ?? false,
    thumbnail: productTypeInfo.thumbnail || productTypeInfo.images[0],
    payment: "cash",
    paymentCash: productTypeInfo.paymentCash ?? 0,
    originPrice: productTypeInfo.originPrice ?? 0,
    itemId: 0,
    storeId: productTypeInfo.storeId || 0,
    brandId: productTypeInfo.brandId || 0,
    categoryStoreId: productTypeInfo.categoryStoreId || 0,
    tags: productTypeInfo.tags || [],
    certificate: productTypeInfo.certificate || '',
  };
};

const createAttributes = async (
  db: any,
  productTypeInfo: any,
  categoryId: number | undefined,
  productTypeId: number
) => {
  const variations = productTypeInfo.variations || [];
  const attributesOwner = [];

  for (const variation of variations) {
    let attributeInfo = await db.attribute.findFirst({
      where: { categoryId, name: variation.name, displayType: "text" },
    });

    if (!attributeInfo) {
      attributeInfo = await db.attribute.create({
        data: {
          name: variation.name,
          displayType: "text",
          categoryId,
        },
      });
    }

    attributesOwner.push(attributeInfo);
    await db.productTypeAttribute.create({
      data: {
        productTypeId,
        attributeId: attributeInfo.id,
      },
    });

    // Tạo attribute values
    for (const option of variation.options) {
      await db.attributevalue.create({
        data: {
          attributeId: attributeInfo.id,
          name: option.value,
          productTypeId,
        },
      });
    }
  }

  return attributesOwner;
};

const createProducts = async (
  db: any,
  productTypeInfo: any,
  productType: any,
  storeInfo: any,
  attributes: any[]
) => {
  const storeProductTypeIds: number[] = [];

  for (const productInfo of productTypeInfo.products || []) {
    const itemInfo = await Item.addItem(
      {
        total: productInfo.total || 0,
      },
      db
    );

    const productData = createProductData(
      productInfo,
      productType,
      itemInfo,
      storeInfo
    );
    const productInsert = await db.product.create({ data: productData });

    // Sử dụng importInventory để tạo inventory và log
    if (productInfo.total > 0) {
      await productInventoryLogService.importInventory({
        productId: productInsert.id,
        quantity: productInfo.total,
        userId: productTypeInfo.userId,
        product: { itemId: itemInfo.id },
        type: 'import'
      });
    }

    await createProductAttributeValues(
      db,
      productInfo,
      productType,
      productInsert,
      attributes
    );
  }

  return storeProductTypeIds;
};

const createProductData = (
  productInfo: any,
  productType: any,
  itemInfo?: any,
  storeInfo?: any,
): Prisma.productCreateInput => ({
  itemId: itemInfo?.id || 0,
  partnerId: productType.partnerId || 0,
  productTypeId: productType.id,
  name: productInfo.name,
  isActive: true,
  description: productInfo.description || '',
  payment: 'cash' as ProductPaymentEnum,
  paymentPoint: productInfo.payment_cash || 0,
  paymentCash: productInfo.payment_cash || 0,
  originPrice: productInfo.origin_price || 0,
  images: productInfo.images,
  storeId: storeInfo?.id || 0,
  weight: productInfo.weight || 0,
  dimensions: productInfo.dimensions || {},
  sku: productInfo.sku || "",
  categoryStoreId: productInfo.categoryStoreId || 0,
});

const createProductAttributeValues = async (
  db: any,
  productInfo: any,
  productType: any,
  productInsert: any,
  attributes: any[]
) => {
  for (let i = 0; i < attributes.length; i++) {
    const attributeValueInfo = productInfo.val_attributes[i];

    const attributeInfo = attributes.find(
      (e) => e.name === attributeValueInfo.name
    );

    if (!attributeInfo) {
      continue;
    }

    let attributeValue = await db.attributevalue.findFirst({
      where: {
        productTypeId: productType.id,
        attributeId: attributeInfo.id,
        name: attributeValueInfo.value,
      },
    });

    if (!attributeValue) {
      attributeValue = await db.attributevalue.create({
        data: {
          productTypeId: productType.id,
          attributeId: attributeInfo.id,
          name: attributeValueInfo.value,
        },
      });
    }

    await db.productattributevalue.create({
      data: {
        productId: productInsert.id,
        attributeValueId: attributeValue.id,
      },
    });
  }
};

const updateProductTypeStores = async (
  db: any,
  productTypeId: number,
  storeProductTypeIds: number[]
) => {
  await db.productType.update({
    where: { id: productTypeId },
    data: {
      storeIds: storeProductTypeIds,
      storeId: storeProductTypeIds.length > 0 ? storeProductTypeIds[0] : 0,
    },
  });
};

const updateAttributes = async (db: any, productTypeInfo: any, categoryId: number | undefined, productTypeId: number) => {
  // Xóa attributes cũ
  await db.productTypeAttribute.deleteMany({
    where: { productTypeId }
  });

  await db.attributevalue.deleteMany({
    where: { productTypeId }
  });

  // Tạo attributes mới
  return createAttributes(db, productTypeInfo, categoryId, productTypeId);
};

const updateProducts = async (db: any, productTypeInfo: any, productType: any) => {
  // Xóa products không còn trong danh sách mới
  const newProductIds = productTypeInfo.products?.map((p: any) => p.id).filter(Boolean);
  await db.product.updateMany({
    where: {
      productTypeId: productType.id,
      id: { notIn: newProductIds || [] }
    },
    data: { isDelete: true }
  });

  // Update hoặc tạo mới products
  for (const productInfo of productTypeInfo.products || []) {
    if (productInfo.id) {
      const existingProduct = await db.product.findUnique({
        where: { id: productInfo.id },
        select: { itemId: true }
      });
      
      if (existingProduct) {
        const productData :any= createProductData(
          productInfo, 
          productType, 
          { id: existingProduct.itemId }, 
          { id: productTypeInfo.storeId }
        );
        
        
        // Update sản phẩm
        await db.product.update({
          where: { id: productInfo.id },
          data: productData
        });

      }
    } else {
      // Tạo mới sản phẩm
      const itemInfo = await Item.addItem({ total: productInfo.total || 0 }, db);
      const productData = createProductData(productInfo, productType, itemInfo, { id: productTypeInfo.storeId });
      const newProduct = await db.product.create({ data: productData });


      // Sử dụng importInventory khi tạo mới sản phẩm
      if (productInfo.total > 0) {
        await productInventoryLogService.importInventory({
          productId: newProduct.id,
          quantity: productInfo.total,
          userId: productTypeInfo.userId,
          product: { itemId: itemInfo.id },
          type: 'import'
        });
      }
    }
  }
};
