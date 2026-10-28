import _ from 'lodash';
// import redis from '../utils/redis';
// import { limiterService } from '../services';
// import itemService from '../services/item.service';
// import { prismaClient } from '@root/src/utils/prisma';
// import { Prisma } from '@src/utils/prisma';
// import moment from 'moment';
import { QueueOptions } from 'bull';
import ConfigSystem from '@src/config/config';
import Queue from 'bull';

interface JobType {
  voucherId: number;
}

const queueOptions: QueueOptions = {
  redis: {
    db: ConfigSystem.REDIS_CONFIG.db,
    password: ConfigSystem.REDIS_CONFIG.password,
    host: ConfigSystem.REDIS_CONFIG.host,
    port: ConfigSystem.REDIS_CONFIG.port,
  },
  prefix: `${process.env.REDIS_PREFIX}bull_queue`,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    timeout: 30000,
    attempts: 5,
    backoff: {
      type: 'fixed',
      delay: 3000,
    },
  },
};
const initQueue = new Queue('init_voucher_limit', queueOptions);
initQueue.process(async (job) => {
  console.log(
    '🚀 ~ file: voucher.helpers.ts:37 ~ initQueue.process ~ job:',
    job
  );
  // const { voucherId }: JobType = job.data;
  // const voucherInfo = await prismaClient.voucher.findUnique({
  //   where: { id: voucherId },
  // });
  // if (!voucherInfo) {
  //   return;
  // }
  // const limiterInfo = await prismaClient.limiter.findFirst({
  //   where: { voucherId: voucherInfo.id },
  // });
  // if (!limiterInfo) {
  //   return;
  // }
  // const listCustomersGetCode: { customerId: number; count: number }[] =
  //   await prismaClient.$queryRaw`
  //   SELECT
  //     	"customerId",
  //     	COUNT ( "customerId" )
  //     FROM
  //     	code
  //     WHERE
  //     	"voucherId" = ${voucherId}
  //     GROUP BY
  //     	"customerId"
  // `;
  // listCustomersGetCode.forEach((e) => {
  //   e.count = Number(e.count);
  // });
  // const stream = redis.scanStream({
  //   match: `${ConfigSystem.REDIS_CONFIG.keyPrefix}{item_${voucherInfo.itemId}:count:customer_*:total}`,
  //   count: 1000,
  // });
  // const now = moment().format('YYYY-MM-DD HH:mm:ss');
  // const pip = redis.multi();
  // stream.on('data', (resultKeys) => {
  //   if (resultKeys.length > 0) {
  //     pip.del(...resultKeys);
  //   }
  // });
  // listCustomersGetCode.forEach((e) => {
  //   pip.set(
  //     limiterService.getKeyItemCustomerCount(voucherInfo.itemId, e.customerId),
  //     e.count
  //   );
  // });
  // const result = await pip.exec();
  // console.log(`[${now}] Init cache limiter voucher ${voucherId} - ${result}`);
});
initQueue.on('failed', (job, err) => {
  console.error(err);
  console.log(
    `Failed job ${job.id} and trying to retry number : ${job.attemptsMade}`
  );
});
initQueue.on('error', (error) => {
  console.log(error);
});

const voucherHelper = {
  initCacheLimitVoucher: async (voucherId?: number) => {
    console.log(
      '🚀 ~ file: voucher.helpers.ts:97 ~ initCacheLimitVoucher: ~ voucherId:',
      voucherId
    );
  },

  addItemToJob: (job: JobType) => {
    initQueue.add(job);
  },

  extractCustomerIdFromKey(input: string) {
    const regex = /\{item_.*?:count:customer_(.+?):total\}/;
    const match = input.match(regex);

    if (match && match[1]) {
      return match[1];
    }
    return null; // Return null if no match is found
  },
};

export default voucherHelper;
