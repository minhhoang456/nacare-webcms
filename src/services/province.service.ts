import { prismaClient } from '@src/utils/prisma';
import localCache from '../utils/localCache';
import redis from '../utils/redis';
import Location from '@root/data/location.json';

export const provinceService = {
  async runInterval5() {
    this.refreshLocal();
  },
  async runCronjob5() {
    this.refreshRemote();
  },
  async bootstrap() {
    await this.refreshRemote();
    await this.refreshLocal();
    await this.initRedisLocation();
  },
  initRedisLocation: async () => {
    const pipeline = redis.pipeline();
    // Load provinces
    if (Array.isArray(Location.province)) {
      Location.province.forEach((p: any) => {
        pipeline.set(`province:${p.id}`, String(p.name));
      });
    } else if (Location.province) {
      Object.entries(Location.province).forEach(([id, name]) => {
        pipeline.set(`province:${id}`, String(name));
      });
    }

    // Load districts (nếu có)
    const districtData = (Location as any).district;
    if (districtData) {
      if (Array.isArray(districtData)) {
        districtData.forEach((d: any) => {
          pipeline.set(`district:${d.id}`, String(d.name));
        });
      } else {
        Object.entries(districtData).forEach(([id, name]) => {
          pipeline.set(`district:${id}`, String(name));
        });
      }
    }

    // Load wards
    if (Array.isArray(Location.ward)) {
      Location.ward.forEach((w: any) => {
        pipeline.set(`ward:${w.id}`, String(w.name));
      });
    } else if (Location.ward) {
      Object.entries(Location.ward).forEach(([id, name]) => {
        pipeline.set(`ward:${id}`, String(name));
      });
    }

    await pipeline.exec();
    console.log('🚀 Location cached ===> Ok!');
  },
  getProvinceNameById: (id: number) => {
    const provinceObj: any = localCache.get('provinces_obj');
    if (!(provinceObj && provinceObj[id])) return 'Toàn quốc';
    return provinceObj[id].name;
  },
  refreshLocal: async () => {
    let provinceInfos: any = await redis.get('provinces');
    provinceInfos = JSON.parse(provinceInfos);
    const provinceObj: any = {};
    provinceInfos.forEach((i: any) => {
      provinceObj[i.id] = i;
    });
    localCache.set('provinces', provinceInfos);
    localCache.set('provinces_obj', provinceObj);
  },
  refreshRemote: async () => {
    try {
      const provinceInfos = await prismaClient.province.findMany();
      await redis.set('provinces', JSON.stringify(provinceInfos));
    } catch (error) {
      console.log(
        '🚀 ~ file: province.service.ts:32 ~ refreshRemote: ~ error:',
        error
      );
    }
  },
};
export default provinceService;
