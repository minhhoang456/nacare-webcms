import { Prisma, prismaClient } from '@src/utils/prisma';
import redis from '../utils/redis';
import _ from 'lodash';
import ono from '@jsdevtools/ono';
import productService from './product.service';
import { item } from '@prisma/client';
import { messagequeueService } from '.';
import moment from 'moment';

const starMap: any = {
  1: 'oneStar',
  2: 'twoStar',
  3: 'threeStar',
  4: 'fourStar',
  5: 'fiveStar',
};
export const itemService = {
  getItemHashKey: (itemId: number) => `item_info_${itemId}`,

  async addItem(data = {}, tnx: any = null) {
    let itemInfo: any = null;
    if (tnx) {
      itemInfo = await tnx.item.create({
        data: data,
      });
    } else {
      itemInfo = await prismaClient.item.create({
        data: data,
      });
    }
    const input: any = {};
    for (const i in Object.values(Prisma.ItemScalarFieldEnum)) {
      if (i === 'createdAt' || i === 'updatedAt') continue;
      if (!itemInfo[i]) continue;
      input[i] = itemInfo[i];
    }
    if (Object.keys(input).length !== 0)
      redis.hmset(this.getItemHashKey(itemInfo.id), input);
    return itemInfo;
  },

  async addManyItemWithEmptyData(totalItems: number) {
    const items = [];
    for (let i = 0; i < totalItems; i++) {
      items.push({});
    }
    const itemInfos: any = await prismaClient.item.createMany({
      skipDuplicates: true,
      data: items,
    });
    try {
      const multi = redis.multi();
      for (let i = 0; i < itemInfos.length; i++) {
        const itemInfo = itemInfos[i];
        const input: any = {};
        for (const i in Object.values(Prisma.ItemScalarFieldEnum)) {
          if (i === 'createdAt' || i === 'updatedAt') continue;
          if (!itemInfo[i]) continue;
          input[i] = itemInfo[i];
        }
        if (Object.keys(input).length === 0) return;
        multi.hmset(this.getItemHashKey(itemInfo.id), input);
      }
      multi.exec().then(() => {});
    } catch (err) {
      console.log(
        '🚀 ~ file: item.ts:53 ~ addManyItemWithEmptyData ~ err:',
        err
      );
    }
    return itemInfos;
  },

  async getListItems(itemIds: number[]) {
    const multi = redis.multi();
    itemIds.forEach((e) => {
      multi.hgetall(this.getItemHashKey(e));
    });
    const replies: any = await multi.exec();
    const result = replies.map((i: any) => {
      return this.fixItemValue(i[1]);
    });
    return result;
  },

  async increaseTotalLike(itemId: number, amount: number) {
    const key = this.getItemHashKey(itemId);
    const totalLike = await redis.hincrby(key, 'totalLike', amount);
    await prismaClient.item.update({
      where: {
        id: itemId,
      },
      data: {
        totalLike: totalLike,
      },
    });
    return totalLike;
  },

  async addRate(itemId: number, star: number) {
    const key = this.getItemHashKey(itemId);
    const starField = starMap[star];
    const multi = redis.multi();
    multi.hincrby(key, 'totalStar', star);
    multi.hincrby(key, starField, 1);
    multi.hincrby(key, 'countRate', 1);
    multi.hgetall(key);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [totalStar, countStarField, countRate, _itemInfo]: any =
      await multi.exec();
    let avgRate = totalStar[1] / countRate[1];
    avgRate = Math.round(avgRate * 10) / 10;
    redis.hset(key, 'avgRate', avgRate);

    messagequeueService.addDbItem({
      model: 'item',
      action: 'update',
      updateCrit: {
        id: itemId,
      },
      data: {
        totalStar: totalStar[1],
        [starField]: countStarField[1],
        countRate: countRate[1],
        avgRate: avgRate,
      },
    });

    return {
      id: itemId,
      avgRate,
      totalStar: totalStar[1],
      countRate: countRate[1],
    };
  },

  async getItemInfo(itemId: number) {
    const key = this.getItemHashKey(itemId);
    let itemInfo: any = await redis.hgetall(key);
    if (Object.keys(itemInfo).length === 0) {
      itemInfo = await prismaClient.item.findUnique({
        where: {
          id: itemId,
        },
      });
      if (!itemInfo) {
        itemInfo = {};
      } else {
        redis.hmset(key, itemInfo).then(() => {});
      }
    }
    itemInfo = this.fixItemValue(itemInfo);
    return itemInfo;
  },

  fixItemValue: (itemInfo: any) => {
    if (!itemInfo) return itemInfo;
    const excludeField: any = { updatedAt: true, createdAt: true };
    const models = Prisma.dmmf.datamodel.models;
    const modelItemField = models.find((e) => e.name === 'item')?.fields;
    if (!modelItemField) return itemInfo;
    for (let i = 0; i < (modelItemField ?? []).length; i++) {
      const fieldItem = modelItemField[i].name;
      const fieldInfo = modelItemField[i];
      if (excludeField[fieldItem]) continue;
      if (!itemInfo[fieldItem]) {
        if (fieldInfo.type === 'Int' || fieldInfo.type === 'Float') {
          itemInfo[fieldItem] = 0;
        }
        if (fieldInfo.type === 'Boolean') {
          itemInfo[fieldItem] = false;
        }
        if (fieldInfo.type === 'String') {
          itemInfo[fieldItem] = '';
        }
      } else {
        if (fieldInfo.type === 'Boolean') {
          itemInfo[fieldItem] = itemInfo[fieldItem] ? 1 : 0;
        }
        if (fieldInfo.type === 'Int' || fieldInfo.type === 'Float') {
          itemInfo[fieldItem] = Number(itemInfo[fieldItem]);
        }
      }
    }
    return itemInfo;
  },

  getHoldingItem: (item: any) => {
    return Number(item.holding) || 0;
  },

  async getQuantityToShowItem(itemId: number) {
    const key = this.getItemHashKey(itemId);
    let itemInfo: any = await redis.hgetall(key);
    if (itemInfo) {
      return (
        Number(itemInfo.total) -
        Number(itemInfo.purchased) -
        this.getHoldingItem(itemInfo)
      );
    } else {
      itemInfo = await prismaClient.item.findUnique({
        where: {
          id: itemId,
        },
      });
      if (itemInfo.length === 0) {
        throw 'Không tìm thấy sản phẩm trong kho';
      }
      await redis.hmset(key, itemInfo);
      return itemInfo.total - itemInfo.purchased;
    }
  },

  async resultFilterConditionOrderItems(carts: any) {
    const itemToHolds = _.cloneDeep(carts);
    const itemIds: number[] = [];
    itemToHolds.forEach((orderItem: any) => {
      itemIds.push(orderItem.itemId);
    });
    const itemTypes = await this.getItemTypesFromItemIds(itemIds);
    const itemTypesConvert = itemTypes.map((item: any) => {
      const temp = item.split('_');
      return { type: temp[0], typeId: temp[1] };
    });

    for (let i = 0; i < itemToHolds.length; i++) {
      if (itemTypesConvert[i].type === 'product') {
        const product = await productService.getProductInfoById(
          itemTypesConvert[i].typeId
        );
        itemToHolds[i].name = product?.name;
      } else {
        // const { voucherInfo } = await Voucher.getVoucherInfoById(
        //   itemTypesConvert[i].typeId
        // )
        // itemToHolds[i].name = voucherInfo.name
        // if (voucherInfo.codeType !== 'import') {
        //   itemToHolds[i].popFromListHold = true
        // }
      }
    }

    const itemOrderHoldFinal = itemToHolds.filter(
      (item: any) => item.popFromListHold !== true
    );
    return itemOrderHoldFinal;
  },

  async holdingItem(itemToHolds: any) {
    const pip = redis.multi();
    const itemInfos: any = [];
    for (let i = 0; i < itemToHolds.length; i++) {
      const itemKey = this.getItemHashKey(itemToHolds[i].itemId);
      const itemInfo = await this.getItemInfo(itemToHolds[i].itemId);
      itemInfos.push(itemInfo);
      pip.hincrby(itemKey, 'purchased', itemToHolds[i].quantity);
    }
    let results: any = await pip.exec();
    results = results.map((item: any) => {
      return Number(item[1]);
    });
    const dateString = moment().format('YYYY-MM-DD HH:mm:ss');
    console.log(`
      [${dateString}] Holding item: ${JSON.stringify(
        itemToHolds
      )} - Result: ${JSON.stringify(results)}`);
    const listNameOverHolding = [];
    for (let i = 0; i < results.length; i++) {
      if (
        Number(itemInfos[i].total) - Number(results[i]) < 0 &&
        itemInfos[i].useQuantity
      ) {
        listNameOverHolding.push(itemToHolds[i].itemId);
      }
    }
    if (listNameOverHolding.length !== 0) {
      this.rollbackHolding(itemToHolds);
      throw ono({
        message: 'e_not_enough_quantity_to_hold',
      });
    }
    return true;
  },

  async rollbackHolding(listItems: { itemId: number; quantity: number }[]) {
    const pip = redis.multi();
    for (let i = 0; i < listItems.length; i++) {
      const itemKey = this.getItemHashKey(listItems[i].itemId);
      pip.hincrby(itemKey, 'purchased', -listItems[i].quantity);
    }
    const result = await pip.exec();
    const dateString = moment().format('YYYY-MM-DD HH:mm:ss');
    console.log(`
      [${dateString}] Rollback holding item: ${JSON.stringify(
        listItems
      )} - Result: ${JSON.stringify(result)}`);
    return;
  },

  async cancelHolding(carts: any) {
    carts = await this.resultFilterConditionOrderItems(carts);

    if (carts.length === 0) {
      return true;
    }
    const pip = redis.multi();
    carts.forEach((cart: any) => {
      const keyItem = this.getItemHashKey(cart.itemId);
      pip.hincrby(keyItem, 'purchased', -Number(cart.quantity));
    });

    await pip.exec();
    return true;
  },

  async completeHolding(orderId: number, customerId: number) {
    const refInfo = await prismaClient.orderitem.findMany({
      where: { orderId: orderId, customerId: customerId },
      select: {
        itemId: true,
        quantity: true,
        type: true,
        typeId: true,
      },
    });
    if (refInfo.length === 0) {
      throw ono({
        code: 'e_can_not_found_order_item',
      });
    }
    for (let i = 0; i < refInfo.length; i++) {
      const item = await prismaClient.item.findUnique({
        where: {
          id: refInfo[i].itemId || 0,
        },
      });
      const purchased = (item?.purchased || 0) + (refInfo[i].quantity || 0);
      if (refInfo[i].itemId) {
        messagequeueService.addDbItem({
          model: 'item',
          action: 'update',
          updateCrit: {
            id: refInfo[i].itemId,
          },
          data: {
            purchased: purchased,
          },
        });
      }
    }
    const dateString = moment().format('YYYY-MM-DD HH:mm:ss');
    console.log(`
      [${dateString}] Complete holding orderId: ${orderId} - CustomerId: ${customerId}`);
    return true;
  },

  async completeHoldingByItemId(itemId: number, quantity: number) {
    // await prismaClient.$transaction(
    //   async (transactionDB: any) => {
    //     const item = await transactionDB.item.findUnique({
    //       where: {
    //         id: itemId
    //       }
    //     })
    //     const purchased = (item?.purchased || 0) + quantity
    //     await transactionDB.item.update({
    //       where: {
    //         id: itemId
    //       },
    //       data: {
    //         purchased: purchased
    //       }
    //     })
    //   },
    //   {
    //     maxWait: 5000,
    //     timeout: 10000
    //   }
    // )
    const item = await prismaClient.item.findUnique({
      where: {
        id: itemId,
      },
    });
    const purchased = (item?.purchased || 0) + quantity;
    messagequeueService.addDbItem({
      model: 'item',
      action: 'update',
      updateCrit: {
        id: itemId,
      },
      data: {
        purchased: purchased,
      },
    });
    return true;
  },

  async initCache() {
    await this.fixMissingItem(); //
    const multi = redis.multi();
    const items = await prismaClient.item.findMany();
    const excludeField: any = { updatedAt: true, createdAt: true };
    const models = Prisma.dmmf.datamodel.models;
    const modelItemField = models.find((e) => e.name === 'item')?.fields;
    const fieldsItem = modelItemField?.map((e) => e.name);
    if (!fieldsItem) return;
    for (let i = 0; i < items.length; i++) {
      const itemInfo: any = items[i];
      const input: any = {};
      for (let i = 0; i < (fieldsItem ?? []).length; i++) {
        if (excludeField[fieldsItem[i]]) continue;
        if (!itemInfo[fieldsItem[i]]) itemInfo[fieldsItem[i]] = 0;
        else input[fieldsItem[i]] = itemInfo[fieldsItem[i]];
      }
      if (Object.keys(input).length === 0) return;
      multi.hmset(this.getItemHashKey(itemInfo.id), input);
    }
    await multi.exec();
    return true;
  },

  getItemIdsFromTypes: async (
    typeInfos: { type: string; typeId: number }[]
  ) => {
    const keys = typeInfos.map((i) => `${i.type}_${i.typeId}`);
    const raw = await redis.hmget('item_map', ...keys);
    const rs = raw.map((i) => Number(i));
    return rs;
  },
  getItemTypesFromItemIds: async (itemIds: number[]) => {
    const rs = await redis.hmget('item_map', ...itemIds.map((e) => String(e)));
    return rs;
  },
  addItemMap: async (itemId: number, type: string, typeId: number) => {
    const key = `item_map`;
    await redis.hset(key, itemId, `${type}_${typeId}`);
    await redis.hset(key, `${type}_${typeId}`, itemId);
  },
  async fixMissingItem() {
    const productTypeInfos = await prismaClient.productType.findMany({
      where: {
        itemId: 0,
      },
      select: {
        id: true,
      },
    });
    const productInfos = await prismaClient.product.findMany({
      where: { itemId: 0 },
      select: {
        id: true,
      },
    });

    for (let i = 0; i < productTypeInfos.length; i++) {
      const itemInfo = await this.addItem();
      await prismaClient.productType.update({
        where: {
          id: productTypeInfos[i].id,
        },
        data: {
          itemId: itemInfo.id,
        },
      });
    }
    for (let i = 0; i < productInfos.length; i++) {
      const itemInfo = await this.addItem();
      await prismaClient.product.update({
        where: {
          id: productInfos[i].id,
        },
        data: { itemId: itemInfo.id },
      });
    }
  },
  async bootstrap() {
    redis
      .set('INIT_CACHE_ITEM', 'LOCK', 'EX', 1 * 60 * 60, 'NX')
      .then(async (result) => {
        if (result === 'OK') {
          this.initCache();
        } else {
          //
        }
      });
  },

  afterCreate: async (itemInfo: any) => {
    try {
      const models = Prisma.dmmf.datamodel.models;
      const modelItemField = models.find((e) => e.name === 'item')?.fields;
      const fieldsItem = modelItemField?.map((e) => e.name);
      if (!fieldsItem) return;
      const input: any = {};
      for (let i = 0; i < fieldsItem.length; i++) {
        if (fieldsItem[i] === 'createdAt' || fieldsItem[i] === 'updatedAt')
          continue;
        if (!itemInfo[fieldsItem[i]]) continue;
        input[fieldsItem[i]] = itemInfo[fieldsItem[i]];
      }
      if (Object.keys(input).length === 0) return;
      redis.hmset(itemService.getItemHashKey(itemInfo.id), input);
    } catch (err) {
      console.log('🚀 ~ file: item.service.ts:8 ~ afterCreate ~ err:', err);
    }
    return itemInfo;
  },

  setCacheForItems: async (items: item[]) => {
    const multi = redis.multi();
    const models = Prisma.dmmf.datamodel.models;
    const modelItemField = models.find((e) => e.name === 'item')?.fields;
    const fieldsItem = modelItemField?.map((e) => e.name);
    if (!fieldsItem) return;
    for (let i = 0; i < items.length; i++) {
      const itemInfo: any = items[i];
      const input: any = {};
      for (let i = 0; i < fieldsItem.length; i++) {
        if (fieldsItem[i] === 'createdAt' || fieldsItem[i] === 'updatedAt')
          continue;
        if (!itemInfo[fieldsItem[i]]) continue;
        input[fieldsItem[i]] = itemInfo[fieldsItem[i]];
      }
      if (Object.keys(input).length === 0) return;
      multi.hmset(itemService.getItemHashKey(itemInfo.id), input);
    }
    await multi.exec();
    return true;
  },

  addViewFavoriteVoucher: async (itemId: number, voucherId: number) => {
    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const hashKey = `voucher:views:${currentDate}`;
    const totalViewVoucher = Number(
      await redis.zincrby(hashKey, 1, Number(voucherId))
    );

    // Set TTL for the hash key to 24 hours
    await redis.expire(hashKey, 86400);

    messagequeueService.addDbItem({
      model: 'item',
      action: 'update',
      updateCrit: {
        id: itemId,
      },
      data: { viewVoucher: Number(totalViewVoucher) },
    });
    return totalViewVoucher;
  },

  getKeyCacheMultiple(itemId: number) {
    return `${process.env.REDIS_PREFIX}-${itemService.getItemHashKey(Number(itemId))}`;
  },

  async holdingItemFlashSale(data: {
    itemsHoldInfo: { itemId: number; quantity: number }[];
    isCalculatPrice: boolean;
  }) {
    const { itemsHoldInfo, isCalculatPrice = false } = data;
    if (itemsHoldInfo.length === 0) {
      return true;
    }
    const pip = redis.multi();
    const itemInfos: any[] = [];
    for (let i = 0; i < itemsHoldInfo.length; i++) {
      const itemKey = itemService.getKeyCacheMultiple(itemsHoldInfo[i].itemId);
      const itemInfo = await itemService.getItemInfo(itemsHoldInfo[i].itemId);
      itemInfos.push(itemInfo);
      pip.hincrby(itemKey, 'purchased', itemsHoldInfo[i].quantity);
    }
    let results: any = await pip.exec();
    if (!results) throw ono({ message: 'e_not_enough_quantity_to_hold' });
    results = results.map((item: any) => {
      return Number(item[1]);
    });
    const itemIdsNotEnough: any = [];
    for (let i = 0; i < results.length; i++) {
      if (Number(itemInfos[i].total) - Number(results[i]) < 0) {
        itemIdsNotEnough.push(itemInfos[i].id);
      }
    }
    if (isCalculatPrice) {
      await this.rollbackHolding(itemsHoldInfo);
    }
    return itemIdsNotEnough;
  },
};
export default itemService;
