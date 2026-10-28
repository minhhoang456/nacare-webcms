import cache from '@src/utils/localCache';
import crypt from '../utils/crypt';
// import productTypeService from './productType.service';
// import { prismaClient } from '../utils/prisma'
// import redis from '@root/src/utils/redis'
export const homeService = {
  updateVersionHome: async () => {
    await cache.set('version_home', crypt.uuid());
  },

  afterUpdate: async (inst: any) => {
    try {
      // await homeService.initCache()
      switch (inst.type) {
        case 'voucher': {
          break;
        }
        case 'product': {
          break;
        }
        // case 'eventgame': {
        //   await EventGame.initCacheHome()
        //   break
        // }
        default: {
          break;
        }
      }
    } catch (error) {
      console.log(error);
    }
    return inst;
  },

  afterCreate: async (inst: any) => {
    try {
      // await homeService.initCache()
      switch (inst.type) {
        case 'voucher': {
          break;
        }
        case 'product': {
          break;
        }
        // case 'eventgame': {
        //   await EventGame.initCacheHome()
        //   break
        // }
        
        default: {
          break;
        }
      }
    } catch (error) {
      console.log(error);
    }
    return inst;
  },

  getVersionHome: async () => {
    const version = await cache.get('version_home');
    return version;
  },

  runCronjob30Minutes: async () => {
    try {
      // await homeService.initCache()
    } catch (error) {
      console.log('Error cache home : ', error);
    }
  },
};
export default homeService;
