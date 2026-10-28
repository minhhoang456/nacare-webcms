// import * as models from "@src/services/index";

import scheduleService from '../services/schedule.service';
import redis from '../utils/redis';
import * as services from '@src/services/index';

declare global {
  interface Array<T> {
    skip(c: number): T[];
    limit(c: number): T[];
    hasSome(fn: (x: T) => boolean): boolean;
  }
  interface MessageError {
    code: number;
    message: string;
  }
}

Array.prototype.skip = function (c: number): any[] {
  return this.filter((_x, i) => {
    if (i > c - 1) {
      return true;
    }
    return false;
  });
};
Array.prototype.limit = function (c: number): any[] {
  return this.filter((_x, i) => {
    if (i <= c - 1) {
      return true;
    }
    return false;
  });
};
Array.prototype.hasSome = function (fn: (x: any) => boolean): boolean {
  for (let i = 0; i < this.length; i++) {
    if (fn(this[i])) {
      return true;
    }
  }
  return false;
};

export default async function () {
  const models = await import('@src/services/index');
  const allModels = Object.values(models);
  await runSchedules();
  await runBootstrap();
  //setup interval
  setInterval(() => {
    runInterval1();
  }, 60000);
  setInterval(() => {
    runInterval5();
  }, 300000);
  setInterval(() => {
    runInitCache();
  }, 60000);

  async function runSchedules() {
    scheduleService.startScheduledTask();
    console.log('🚀 Schedules ===> Ok!');
  }

  async function runInterval1() {
    allModels.forEach((model: any) => {
      if (model.runInterval1) {
        try {
          model.runInterval1().then(() => {});
        } catch (error) {
          console.error('interval1 error ', error);
        }
      }
    });
  }

  async function runInterval5() {
    allModels.forEach((model: any) => {
      if (model.runInterval5) {
        try {
          model.runInterval5().then(() => {});
        } catch (error) {
          console.error('interval1 error ', error);
        }
      }
    });
  }

  async function runBootstrap() {
    const promises: any = [];
    allModels.forEach((model: any) => {
      if (model.bootstrap) {
        try {
          promises.push(model.bootstrap());
        } catch (error) {
          console.error('bootstrap error ', error);
        }
      }
    });
    if (promises.length > 0) await Promise.all(promises);
  }

  async function runInitCache() {
    try {
      redis
        .set('FIRST_INITCACHE', 'LOCK', 'EX', 24 * 60 * 60, 'NX')
        .then(async (result) => {
          if (result === 'OK') {
            const models: any = services;
            try {
              for (const index in models) {
                const model = models[index];
                if (model.initCache) {
                  try {
                    services.cronJobService.addInitItem({
                      modelName: index,
                      type: 'init-cache',
                    });
                  } catch (error) {
                    console.error('init cache error ', error);
                  }
                }
              }
            } catch (err) {
              console.log('🚀 ~ initIndexSearchVoucher ~ err:', err);
            }
          } else {
            /** */
          }
        });
    } catch (error) {
      /** */
    }
  }
}
