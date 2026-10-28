import { prismaClient } from "@src/utils/prisma";
import localCache from "../utils/localCache";
import redis from "../utils/redis";

export const storeService = {

  getStoreInfoById: async (storeId: number) => {
    const key = `store_info_${storeId}`;
    let storeInfo = localCache.get(key);
    if (storeInfo) return storeInfo;
    storeInfo = await prismaClient.store.findUnique({
      where: {
        id: storeId,
      },
    });
    localCache.set(key, storeInfo, 300);
    return storeInfo;
  },
  getStoreInfos: async (storeIds: number[]) => {
    let storeInfos = await redis.hmget(
      "list_store_infos",
      ...storeIds.map((e) => String(e))
    );
    if (storeInfos.length > 0) {
      storeInfos = storeInfos.map((e: any) => JSON.parse(e));
    }
    return storeInfos;
  },

  getListStores: async () => {
    const storeIds = await redis.smembers("list_id_store");
    let listStore = await redis.hmget("list_store_infos", ...storeIds);
    listStore = listStore.map((i: any) => JSON.parse(i));
    return listStore;
  },

  async refreshCache() {
    try {
      const stores = await prismaClient.store.findMany();
      if (stores.length === 0) {
        return;
      }
      const storeId = stores.map((e) => e.id);
      const multi = redis.multi();
      multi.del("list_store_infos");
      multi.del("list_id_store");

      if (storeId.length > 0) {
        multi.sadd("list_id_store", storeId);
      }
      stores.forEach((storeInfo) => {
        multi.hmset(
          "list_store_infos",
          storeInfo.id,
          JSON.stringify(storeInfo)
        );
      });
      await multi.exec();
    } catch (error) {
      console.log(
        "🚀 ~ file: store.service.ts:86 ~ refreshCache ~ error:",
        error
      );
    }
  },
  getStoreList: async (latitude: number, longitude: number, radius: number) => {
    await storeService.syncStoreGPS();
    const result = await redis.georadius(
      "PARTNER_GPS",
      longitude,
      latitude,
      radius,
      "km",
      "WITHDIST",
      "WITHCOORD",
      "ASC"
    );

    const partners: any[] = result.map((item: any) => {
      const partnerInfo = JSON.parse(item[0]);
      return {
        ...partnerInfo,
        distance: Number(item[1]),
        lat: Number(item[2][1]),
        long: Number(item[2][0]),
      };
    });

    return partners;
  },
  getStoreListV2: async (
    latitude: number,
    longitude: number,
    radius: number,
    storeIds?: number[]
  ) => {
    await storeService.syncStoreGPS();
    const result = await redis.georadius(
      "PARTNER_GPS",
      longitude,
      latitude,
      radius,
      "km",
      "WITHDIST",
      "WITHCOORD",
      "ASC"
    );

    const partners: any[] = result
      .map((item: any) => {
        const partnerInfo = JSON.parse(item[0]);
        return {
          ...partnerInfo,
          distance: Number(item[1]),
          lat: Number(item[2][1]),
          long: Number(item[2][0]),
        };
      })
      .filter((partner: any) => !storeIds || storeIds.includes(partner.id));

    return partners;
  },
  syncStoreGPS: async () => {
    const stores = await prismaClient.store.findMany({
      select: {
        id: true,
        gpsLocation: true,
        phone: true,
        name: true,
        address: true,
        provinceId: true,
        districtId: true,
        wardId: true,
        logo: true,
      },
    });

    if (stores.length === 0) {
      return;
    }

    const multi: any = redis.multi();
    multi.del("PARTNER_GPS");

    stores.forEach((store) => {
      if (!store.gpsLocation) {
        return;
      }

      const coordinates = store.gpsLocation.split("/");
      const latitude = Number(coordinates[0]);
      const longitude = Number(coordinates[1]);

      if (isNaN(latitude) || isNaN(longitude)) {
        return;
      }

      multi.geoadd(["PARTNER_GPS", longitude, latitude, JSON.stringify(store)]);
    });

    await multi.exec();
  },
};
export default storeService;
