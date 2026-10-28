import { prismaClient } from '@root/src/utils/prisma';
import redis from '../utils/redis';
import common from '../utils/common';
export const basicAuthService = {
  bootstrap: async () => {
    try {
      await basicAuthService.initCache();
    } catch (error) {
      console.log(
        '🚀 ~ file: basicAuth.service.ts:11 ~ bootstrap: ~ error:',
        error
      );
    }
  },
  beforeCreate: async (basic: any) => {
    try {
      const authCode = common.generateBasicAuthHeader(
        basic.username,
        basic.password
      );
      basic.auth = authCode;
    } catch (error) {
      console.log(
        '🚀 ~ file: basicAuth.service.ts:22 ~ beforeCreate: ~ error:',
        error
      );
    }
    return basic;
  },
  beforeUpdate: async (basic: any) => {
    try {
      const authCode = common.generateBasicAuthHeader(
        basic.username,
        basic.password
      );
      basic.auth = authCode;
    } catch (error) {
      console.log(
        '🚀 ~ file: basicAuth.service.ts:22 ~ beforeCreate: ~ error:',
        error
      );
    }
    return basic;
  },
  afterUpdate: async (basic: any) => {
    try {
      basicAuthService.initCache();
    } catch (error) {
      console.log(
        '🚀 ~ file: basicAuth.service.ts:18 ~ afterCreate: ~ error:',
        error
      );
    }
    return basic;
  },
  afterCreate: async (basic: any) => {
    try {
      basicAuthService.initCache();
    } catch (error) {
      console.log(
        '🚀 ~ file: basicAuth.service.ts:18 ~ afterCreate: ~ error:',
        error
      );
    }
    return basic;
  },
  getBasicAuth: async (username: string, password: string) => {
    try {
      const basicsCache = await redis.get('list_basic_auth');
      if (basicsCache) {
        const basics = JSON.parse(basicsCache);
        const basic = basics?.find(
          (item: any) =>
            item.username === username && item.password === password
        );
        if (basic) {
          return basic;
        }
        return null;
      }
      return null;
    } catch (error) {
      return null;
    }
  },
  initCache: async () => {
    try {
      const basics = await prismaClient.basicAuth.findMany({
        where: {
          state: true,
        },
        select: {
          id: true,
          name: true,
          username: true,
          password: true,
          ip: true,
        },
      });
      if (basics.length === 0) {
        return;
      }
      await redis.set('list_basic_auth', JSON.stringify(basics));
    } catch (error) {
      console.log(
        '🚀 ~ file: basicAuth.service.ts:17 ~ initCache: ~ error:',
        error
      );
    }
  },
};
export default basicAuthService;
