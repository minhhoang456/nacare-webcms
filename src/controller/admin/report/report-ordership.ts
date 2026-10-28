import { prismaClient } from "@root/src/utils/prisma";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import moment from "moment";
import userMidlleware from "@root/src/middleware/user";
import redis from "@root/src/utils/redis";

type OrderStatus = 'pending' | 'processing' | 'wait_for_confirmation' | 'wait_for_pickup' | 'shipping' | 'completed' | 'canceled' | 'refund' | 'refunded';

export default async (fastify: FastifyInstance) => {
  fastify.withTypeProvider<ZodTypeProvider>().route({
    method: "GET",
    url: `/report-ordership`,
    preHandler: [userMidlleware as any],
    schema: {
      querystring: z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        timeFrame: z.enum(['7days', 'month', 'year', 'custom']).optional(),
      }),
      response: {
      },
    },
    handler: async (req: any, res) => {
      try {
        const { startDate, endDate, timeFrame } = req.query;
        // @ts-ignore
        const storeId = req.storeId;

        const cacheKey = `report-ordership:${storeId}:${timeFrame || 'custom'}:${startDate || ''}:${endDate || ''}`;

        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
          return res.send(JSON.parse(cachedData));
        }

        const { orderData, overallStats } = await getOrdershipStatistics(startDate, endDate, timeFrame, storeId);
        const topProducts = await getTopProducts(storeId);

        const responseData = {
          code: 0,
          message: "Lấy thành công",
          data: {
            orderData,
            overallStats,
            topProducts,
          },
        };

        await redis.set(cacheKey, JSON.stringify(responseData), "EX", 300);

        return res.send(responseData);
      } catch (error) {
        console.error("Lỗi trong report-ordership:", error);
        return res.send({
          code: -1,
          message: 'Hệ thống bận!',
        });
      }
    },
  });
};

async function getOrdershipStatistics(startDate?: string, endDate?: string, timeFrame?: string, storeId?: number) {
  let whereClause: any = {};

  if (storeId) {
    whereClause.storeId = storeId;
  }

  if (timeFrame === 'custom' && startDate && endDate) {
    whereClause.createdAt = {
      gte: moment(startDate).startOf('day').valueOf(),
      lte: moment(endDate).endOf('day').valueOf(),
    };
  } else if (timeFrame === '7days') {
    whereClause.createdAt = {
      gte: moment().subtract(7, 'days').startOf('day').valueOf(),
    };
  } else if (timeFrame === 'month') {
    whereClause.createdAt = {
      gte: moment().startOf('month').valueOf(),
    };
  } else if (timeFrame === 'year') {
    whereClause.createdAt = {
      gte: moment().startOf('year').valueOf(),
    };
  }

  const orderships = await prismaClient.ordership.findMany({
    where: whereClause,
    select: {
      createdAt: true,
      totalMoney: true,
      status: true,
      storeId: true,
    },
  });

  // Process and aggregate data
  const orderData = processOrdershipData(orderships, timeFrame);

  // Calculate overall statistics
  const overallStats = calculateOverallStats(orderships);

  return { orderData, overallStats };
}

function processOrdershipData(orderships: any[], timeFrame?: string) {
  const dataMap = new Map();

  orderships.forEach(ordership => {
    const dateFormat = timeFrame === 'year' ? 'MM/YYYY' : 'DD/MM/YYYY';
    const date = moment(ordership.createdAt).format(dateFormat);

    if (!dataMap.has(date)) {
      dataMap.set(date, {
        date,
        orders: 0,
        revenue: 0,
        statusCounts: {
          pending: 0,
          processing: 0,
          wait_for_confirmation: 0,
          wait_for_pickup: 0,
          shipping: 0,
          completed: 0,
          canceled: 0,
          refund: 0,
          refunded: 0
        }
      });
    }
    const data = dataMap.get(date);
    data.orders++;

    const status = ordership.status as OrderStatus;
    if (status in data.statusCounts) {
      data.statusCounts[status]++;
    }

    // Chỉ tính doanh thu cho đơn hàng đã hoàn thành
    if (status === 'completed') {
      data.revenue += ordership.totalMoney || 0;
    }
  });

  return Array.from(dataMap.values());
}

function calculateOverallStats(orderships: any[]) {
  const stats = {
    totalOrders: orderships.length,
    totalRevenue: 0,
    statusCounts: {
      pending: 0,
      processing: 0,
      wait_for_confirmation: 0,
      wait_for_pickup: 0,
      shipping: 0,
      completed: 0,
      canceled: 0,
      refund: 0,
      refunded: 0
    }
  };

  orderships.forEach(order => {
    const status = order.status as OrderStatus;
    if (status === 'completed') {
      stats.totalRevenue += order.totalMoney || 0;
    }
    if (status in stats.statusCounts) {
      stats.statusCounts[status]++;
    }
  });

  return stats;
}

async function getTopProducts(storeId?: number) {
  const products = await prismaClient.product.findMany({
    where: { 
      storeId,
      isDelete: false 
    },
    select: {
      id: true,
      name: true,
      paymentCash: true,
      storeId: true,
      itemId: true
    }
  });

  if (products.length === 0) {
    return [];
  }

  const itemIds = products.map(p => p.itemId).filter(Boolean);
  
  const topItems = await prismaClient.item.findMany({
    where: {
      id: {
        in: itemIds
      }
    },
    orderBy: {
      purchased: 'desc'
    },
    take: 5,
    select: {
      id: true,
      purchased: true
    }
  });

  const productMap = new Map(
    products.map(p => [p.itemId, p])
  );

  return topItems.map(item => {
    const productInfo = productMap.get(item.id);
    return {
      id: item.id,
      name: productInfo?.name || '',
      quantity: item.purchased || 0,
      revenue: (item.purchased || 0) * (productInfo?.paymentCash || 0),
      storeId: productInfo?.storeId
    };
  });
}

// skip: z
//       .number()
//       .or(z.string().regex(/\d+/).transform(Number))
//       .refine((n) => n >= 0),
