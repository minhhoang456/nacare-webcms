import redis from '@root/src/utils/redis';
import { prismaClient } from '@root/src/utils/prisma';

const CACHE_KEY_PREFIX = 'summary';
const CACHE_EXPIRE_TIME = 24 * 60 * 60; // 24 hours

export const summaryService = {
  // Hàm khởi tạo cache
  async initCache() {
    try {
      const currentYear = new Date().getFullYear();
      
      // Check if summary exists for current year
      const existingSummary = await prismaClient.summary.findFirst({
        where: {
          year: currentYear
        }
      });

      if (!existingSummary) {
        // Create new summary for current year
        await prismaClient.summary.create({
          data: {
            year: currentYear,
            value: {
              totalSellers: 0,
              newSellers: 0,
              totalProducts: 0,
              newProducts: 0,
              totalOrders: { total: 0, completed: 0, canceled: 0 },
              totalTransactionValue: 0,
            },
            isUpdate: false,
            createdAt: new Date().getTime(),
            updatedAt: new Date().getTime()
          }
        });

        // Run cronjob to populate data
        await summaryService.runCronjobEndOfDay();
      }

      // Cache the summary data in Redis
      const summaryData = await prismaClient.summary.findFirst({
        where: {
          year: currentYear
        }
      });

      if (summaryData) {
        await redis.set(
          `${CACHE_KEY_PREFIX}:${currentYear}`,
          JSON.stringify(summaryData.value),
          'EX',
          CACHE_EXPIRE_TIME
        );
      }

    } catch (error) {
      console.error('Error in initCache:', error);
    }
  },

  bootstrap: async () => {
    await summaryService.initCache();
    await summaryService.runCronjobEndOfDay();
  },

  async runCronjobEndOfDay() {
    try {
      const currentYear = new Date().getFullYear();
      const startOfYear = new Date(currentYear, 0, 1).getTime();
      const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59).getTime();

      let stats = {
        totalSellers: 0,
        newSellers: 0,
        totalProducts: 0,
        newProducts: 0,
        totalOrders: {
          total: 0,
          completed: 0,
          canceled: 0
        },
        totalTransactionValue: 0
      };

      const storeStats = await prismaClient.$queryRaw<{ total: bigint; new_count: bigint }[]>`
        WITH store_stats AS (
          SELECT 
            state,
            "createdAt"
          FROM store 
          WHERE state = true
          AND "createdAt" <= ${endOfYear}
        )
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER(WHERE "createdAt" >= ${startOfYear}) as new_count
        FROM store_stats
      `;

      const productStats = await prismaClient.$queryRaw<{ total: bigint; new_count: bigint }[]>`
        WITH product_stats AS (
          SELECT 
            "isActive",
            "isApprove",
            "createdAt"
          FROM "producttype"
          WHERE "isActive" = true 
          AND "isApprove" = true
          AND "createdAt" <= ${endOfYear}
        )
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER(WHERE "createdAt" >= ${startOfYear}) as new_count
        FROM product_stats
      `;

      const orderStats = await prismaClient.$queryRaw<{
        total: bigint;
        completed: bigint;
        canceled: bigint;
        transaction_value: bigint;
      }[]>`
        WITH order_stats AS (
          SELECT 
            status,
            "totalMoney",
            "createdAt"
          FROM ordership
          WHERE "createdAt" BETWEEN ${startOfYear} AND ${endOfYear}
        ),
        status_counts AS (
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER(WHERE status = 'completed') as completed,
            COUNT(*) FILTER(WHERE status = 'canceled') as canceled
          FROM order_stats
        ),
        transaction_sum AS (
          SELECT
            COALESCE(SUM("totalMoney") FILTER(WHERE status = 'completed'), 0) as transaction_value
          FROM order_stats
        )
        SELECT 
          sc.total,
          sc.completed,
          sc.canceled,
          ts.transaction_value
        FROM status_counts sc
        CROSS JOIN transaction_sum ts
      `;

      stats = {
        totalSellers: Number(storeStats[0]?.total) || 0,
        newSellers: Number(storeStats[0]?.new_count) || 0,
        totalProducts: Number(productStats[0]?.total) || 0,
        newProducts: Number(productStats[0]?.new_count) || 0,
        totalOrders: {
          total: Number(orderStats[0]?.total) || 0,
          completed: Number(orderStats[0]?.completed) || 0,
          canceled: Number(orderStats[0]?.canceled) || 0
        },
        totalTransactionValue: Number(orderStats[0]?.transaction_value) || 0
      };

      await prismaClient.summary.updateMany({
        where: {
          year: currentYear
        },
        data: {
          value: stats,
          isUpdate: true,
          updatedAt: new Date().getTime()
        }
      });

      const pipeline = redis.pipeline();
      pipeline.set(
        `${CACHE_KEY_PREFIX}:${currentYear}`,
        JSON.stringify(stats),
        'EX',
        CACHE_EXPIRE_TIME
      );
      await pipeline.exec();

    } catch (error) {
      console.error('Error updating summary:', error);
    }
  },

  async getSummary() {
    try {
      const currentYear = new Date().getFullYear();
      
      const cachedData = await redis.get(`${CACHE_KEY_PREFIX}:${currentYear}`);
      if (cachedData) {
        return JSON.parse(cachedData);
      }

      const summaryData = await prismaClient.summary.findFirst({
        where: {
          year: currentYear
        }
      });

      if (!summaryData) {
        return {
          totalSellers: 0,
          newSellers: 0,
          totalProducts: 0,
          newProducts: 0,
          totalOrders: { total: 0, completed: 0, canceled: 0 },
          totalTransactionValue: 0,
        };
      }

      const pipeline = redis.pipeline();
      pipeline.set(
        `${CACHE_KEY_PREFIX}:${currentYear}`,
        JSON.stringify(summaryData.value),
        'EX',
        CACHE_EXPIRE_TIME
      );
      await pipeline.exec();

      return summaryData.value;
    } catch (error) {
      console.error('Error in getSummary:', error);
      return {
        totalSellers: 0,
        newSellers: 0,
        totalProducts: 0,
        newProducts: 0,
        totalOrders: { total: 0, completed: 0, canceled: 0 },
        totalTransactionValue: 0,
      };
    }
  }
};

export default summaryService;
