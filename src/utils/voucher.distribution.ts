import redis from '@root/src/utils/redis';
import { prismaClient } from './prisma';

export enum VoucherErrorCode {
  SYSTEM_BUSY = 'SYSTEM_BUSY',
  EXPIRED = 'VOUCHER_EXPIRED',
  DEPLETED = 'VOUCHER_DEPLETED',
  INVALID = 'VOUCHER_INVALID',
  ALREADY_USED = 'VOUCHER_ALREADY_USED',
  RULE_VIOLATION = 'VOUCHER_RULE_VIOLATION',
  ALREADY_CLAIMED = 'VOUCHER_ALREADY_CLAIMED',
  LIMIT_EXCEEDED = 'VOUCHER_LIMIT_EXCEEDED',
  RATE_LIMIT = 'VOUCHER_RATE_LIMIT',
}
export interface VoucherCacheData {
  id: number;
  name: string;
  thumb: string;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  stock: number;
  limiter: {
    limitProgram: number;
    limitUserProgram: number;
  };
  minOrderAmount?: number;
  maxDiscountAmount?: number;
  discountAmount?: number;
  discountType?: string;
}
export interface VoucherDistributionResult {
  success: boolean;
  codeId?: number;
  code?: string;
  expiredAt?: number;
  voucherId?: number;
  customerId?: number;
  message?: string;
  error?: string;
  errorCode?: VoucherErrorCode;
}
export interface GetActiveVouchersParams {
  skip?: number;
  limit?: number;
  customerId?: number;
}
export interface VoucherListResponse {
  vouchers: VoucherCacheData[];
  total: number;
}

export class VoucherError extends Error {
  constructor(
    public code: VoucherErrorCode,
    public message: string,
    public details?: any
  ) {
    super(message);
  }
}

export default class VoucherDistributionService {
  private static instance: VoucherDistributionService;

  private readonly VOUCHER_LIST_KEY = 'voucher:active:list';
  private readonly VOUCHER_COUNT_KEY = 'voucher:active:count';

  // Cache frequently accessed data
  private readonly VOUCHER_DETAILS = 'voucher:details:';
  private readonly VOUCHER_CACHE_TTL = 60 * 1000; // 1 minute

  private readonly CACHE_TTL = 300; // 5 minutes
  constructor() {}

  static getInstance(): VoucherDistributionService {
    return (VoucherDistributionService.instance ??=
      new VoucherDistributionService());
  }

  async getCanClaimVouchers({
    skip = 0,
    limit = 10,
    customerId,
  }: GetActiveVouchersParams): Promise<VoucherListResponse> {
    try {
      const [cachedList, cachedCount] = await Promise.all([
        redis.lrange(this.VOUCHER_LIST_KEY, skip, skip + limit - 1),
        redis.get(this.VOUCHER_COUNT_KEY),
      ]);

      if (cachedList.length > 0 && cachedCount) {
        const vouchers = cachedList.map((item) => JSON.parse(item));
        const enrichedVouchers = await this.enrichWithRealTimeData(vouchers);

        if (customerId) {
          const filteredVouchers = await this.filterEligibleVouchers(
            enrichedVouchers,
            customerId
          );
          return {
            vouchers: filteredVouchers,
            total: parseInt(cachedCount),
          };
        }

        return {
          vouchers: enrichedVouchers,
          total: parseInt(cachedCount),
        };
      }

      // If not in cache, get from database
      const now = Date.now();
      const [vouchers, total] = await prismaClient.$transaction([
        prismaClient.voucher.findMany({
          where: {
            AND: [
              {
                limiter: {
                  OR: [{ limitProgram: { gt: 0 } }, { limitProgram: -1 }],
                },
              },
              { payment: 'free' },
              { startDate: { lte: now } },
              { endDate: { gte: now } },
              { isActive: true },
              { isApprove: true },
            ],
          },
          include: {
            limiter: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prismaClient.voucher.count({
          where: {
            AND: [
              {
                limiter: {
                  OR: [{ limitProgram: { gt: 0 } }, { limitProgram: -1 }],
                },
              },
              { payment: 'free' },
              { startDate: { lte: now } },
              { endDate: { gte: now } },
              { isActive: true },
              { isApprove: true },
            ],
          },
        }),
      ]);

      // Cache the full list and count
      await this.cacheVoucherList(vouchers, total);

      // Enrich with real-time data
      const enrichedVouchers = await this.enrichWithRealTimeData(vouchers);

      if (customerId) {
        const filteredVouchers = await this.filterEligibleVouchers(
          enrichedVouchers,
          customerId
        );
        return {
          vouchers: filteredVouchers,
          total,
        };
      }

      return {
        vouchers: enrichedVouchers,
        total,
      };
    } catch (error) {
      console.error('Error fetching active vouchers:', error);
      return {
        vouchers: [],
        total: 0,
      };
    }
  }

  async getVoucherWithCache(voucherId: number, tx?: any): Promise<any> {
    const cacheKey = `${this.VOUCHER_DETAILS}${voucherId}`;

    const cachedVoucher = await redis.get(cacheKey);
    if (cachedVoucher) {
      return JSON.parse(cachedVoucher);
    }

    const lockKey = `voucher:lock:${voucherId}`;
    const lockValue = Date.now().toString();
    const acquiredLock = await redis.set(lockKey, lockValue, 'PX', 5000, 'NX'); // 5s lock

    if (!acquiredLock) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return this.getVoucherWithCache(voucherId, tx);
    }

    try {
      const voucher = tx
        ? await tx.voucher.findUnique({
            where: { id: voucherId },
            include: { limiter: true },
          })
        : await prismaClient.voucher.findUnique({
            where: { id: voucherId },
            include: { limiter: true },
          });

      if (voucher) {
        await redis.set(
          cacheKey,
          JSON.stringify(voucher),
          'EX',
          this.VOUCHER_CACHE_TTL
        );
      }

      return voucher;
    } finally {
      const currentLock = await redis.get(lockKey);
      if (currentLock === lockValue) {
        await redis.del(lockKey);
      }
    }
  }

  // Private methods stock------------------------------------------------------------

  private async cacheVoucherList(
    vouchers: any[],
    total: number
  ): Promise<void> {
    const pipeline = redis.multi();

    pipeline.del(this.VOUCHER_LIST_KEY);

    vouchers.forEach((voucher) => {
      pipeline.rpush(this.VOUCHER_LIST_KEY, JSON.stringify(voucher));
    });

    pipeline.expire(this.VOUCHER_LIST_KEY, this.CACHE_TTL);

    pipeline.set(
      this.VOUCHER_COUNT_KEY,
      total.toString(),
      'EX',
      this.CACHE_TTL
    );

    await pipeline.exec();
  }

  private async enrichWithRealTimeData(
    vouchers: any[]
  ): Promise<VoucherCacheData[]> {
    const pipeline = redis.multi();
    // Get real-time stock for all vouchers
    vouchers.forEach((voucher) => {
      pipeline.get(`voucher:${voucher.id}:total`);
    });
    const results = await pipeline.exec();

    return vouchers.map((voucher, index) => ({
      id: voucher.id,
      name: voucher.name,
      thumb: voucher.thumb,
      startDate: voucher.startDate,
      endDate: voucher.endDate,
      isActive: voucher.isActive,
      minOrderAmount: voucher.minAmountPayment,
      maxDiscountAmount: voucher.valueMaxDiscount,
      discountAmount: voucher.valueDiscount,
      discountType: voucher.voucherTypeDiscount,
      stock:
        voucher.limiter?.limitProgram != -1
          ? voucher.limiter?.limitProgram -
            parseInt((results?.[index]?.[1] as string) || '0')
          : -1,
      limiter: {
        limitProgram: voucher.limiter?.limitProgram,
        limitUserProgram: voucher.limiter?.limitUserProgram,
      },
    }));
  }

  private async filterEligibleVouchers(
    vouchers: VoucherCacheData[],
    customerId: number
  ): Promise<VoucherCacheData[]> {
    if (!customerId) return vouchers;

    const pipeline = redis.multi();

    // Check claims for all vouchers
    vouchers.forEach((voucher) => {
      pipeline.get(`voucher:${voucher.id}:user:${customerId}`);
    });

    const claims = await pipeline.exec();

    const filteredVouchers = vouchers.filter((voucher, index) => {
      const claim = claims?.[index]?.[1];
      const valid = voucher.stock === -1 ? true : !claim && voucher.stock > 0;
      return valid;
    });

    return filteredVouchers;
  }
}
