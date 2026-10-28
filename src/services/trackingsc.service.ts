import moment from 'moment';
import { prismaClient } from '../utils/prisma';
import Queue, { QueueOptions } from 'bull';
import ConfigSystem from '@src/config/config';

export enum TrackingActionType {
  V_HOME_SEARCH = 'vHomeSearch',
  V_HOME_CATEGORY = 'vHomeCategory',
  V_HOME_BLOCK_MORE = 'vHomeBlockMore',
  V_HOME_DETAIL_PRODUCT = 'vHomeDetailProduct',
  V_HOME_BANNER = 'vHomeBanner',
  V_HOME_PARTNER = 'vHomePartner',
  V_HOME_PARTNER_DETAIL = 'vHomePartnerDetail',
  V_PRODUCT_STORE = 'vProductStore',
  V_PRODUCT_STORE_DETAIL = 'vProductStoreDetail',
  V_PRODUCT_DETAIL = 'vProductDetail',
  V_PRODUCT_ADD_CART = 'vProductAddCart',
  V_CHECKOUT_ADDRESS = 'vCheckoutAddress',
  V_CHECKOUT_EDIT_CART = 'vCheckoutEditCart',
  V_CHECKOUT_CHOOSE_SHIP_SERVICE = 'vCheckoutChooseShipService',
  V_CHECKOUT_VIEW_VOUCHER = 'vCheckoutViewVoucher',
  V_CHECKOUT_CHOOSE_VOUCHER = 'vCheckoutChooseVoucher',
  V_CHECKOUT_CONFIRM_ORDER = 'vCheckoutConfirmOrder',
  V_ORDER_DETAIL = 'vOrderDetail',
  V_ORDER_CANCEL = 'vOrderCancel',
  V_NOTIFICATION = 'vNotification',
  V_RATING_ORDER = 'vRatingOrder',
  V_REORDER = 'vReorder',
}

interface TrackingData {
  actionType: TrackingActionType;
}

const queueOptions: QueueOptions = {
  redis: {
    db: ConfigSystem.REDIS_CONFIG.db,
    password: ConfigSystem.REDIS_CONFIG.password,
    host: ConfigSystem.REDIS_CONFIG.host,
    port: ConfigSystem.REDIS_CONFIG.port,
  },
  prefix: `${process.env.REDIS_PREFIX}tracking_queue`,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    attempts: 3,
  },
  settings: {
    stalledInterval: 60000,
  },
};

const trackingQueue = new Queue('tracking_sync', queueOptions);

trackingQueue.process(async (job) => {
  const { actionType } = job.data;
  await trackAction({ actionType });
});

trackingQueue.on('failed', (job, err) => {
  console.error(err);
  console.log(`Failed job ${job.id} and trying to retry number : ${
    job.attemptsMade
  } 
  Data : ${JSON.stringify(job.data)}`);
});

trackingQueue.on('error', (error) => {
  console.log(error);
});

const trackAction = async (data: TrackingData) => {
  try {
    const dateMs = moment().startOf('day').valueOf();
    const tracking: any = {
      targetId: dateMs,
    };
    for (const action of Object.values(TrackingActionType)) {
      tracking[action] = action === data.actionType ? 1 : 0;
    }
    const query = generateUpdateQuery(tracking);
    await prismaClient.$queryRawUnsafe(query);
    return true;
  } catch (error) {
    console.error('Track action error:', error);
    return false;
  }
};

const generateUpdateQuery = (updateData: any) => {
  const tableName = 'trackingsc';
  if (!updateData || typeof updateData !== 'object')
    throw new Error('Invalid arguments: updateData must be an object.');

  const columns = Object.keys(updateData);
  const values = Object.values(updateData);
  const setClause = columns
    .filter((col) => col !== 'targetId')
    .map((col) => `"${col}" = ${tableName}."${col}" + EXCLUDED."${col}"`)
    .join(', ');

  const query = `INSERT INTO ${tableName} (${columns
    .map((col) => `"${col}"`)
    .join(', ')}) 
    VALUES (${values.join(', ')}) 
    ON CONFLICT ("targetId") 
    DO UPDATE SET ${setClause}`;

  return query;
};

export const trackingscService = {
  addTracking: async (data: TrackingData) => {
    await trackingQueue.add(data);
  },
};
export default trackingscService;
