import redis from './redis';
import VoucherDistributionService, {
  VoucherErrorCode,
} from './voucher.distribution';
import { prismaClient } from './prisma';
import crypto from 'crypto';
import moment from 'moment';
import { performance } from 'perf_hooks';
import { VoucherTypeDiscount } from '../services/voucher.service';

export interface GetApplicableVoucherCodesParams {
  customerId: number;
  orderAmount?: number;
  storeId?: number;
  productIds?: number[];
  skip?: number;
  limit?: number;
}

export interface ApplicableVoucherCodeResult {
  code: string;
  expiredAt: number;
  discountAmount?: number;
  voucherInfo: {
    id: number;
    name: string;
    thumb: string;
    voucherTypeDiscount: number;
    valueDiscount?: number;
    valuePercentDiscount?: number;
    valueMaxDiscount?: number;
    minAmountPayment?: number;
    endDate: number;
  };
}

export interface ValidationResult {
  isValid: boolean;
  discountAmount?: number;
  error?: string;
  errorCode?: VoucherErrorCode;
  voucherInfo?: any;
}

export default class VoucherCodeService {
  private static instance: VoucherCodeService;
  private voucherDistribution: VoucherDistributionService;

  private static BATCH_SIZE = 100; // For pre-generating codes

  private readonly CUSTOMER_CODES_KEY = 'customer:codes:'; // Customer's active codes
  private readonly CODE_LOCK_KEY = 'voucher:code:lock:'; // Lock for using code
  private readonly CODE_PREFIX_LENGTH = 2;
  private readonly CODE_LENGTH = 12; // Total length including prefix

  constructor() {
    this.voucherDistribution = VoucherDistributionService.getInstance();
  }

  static getInstance(): VoucherCodeService {
    return (VoucherCodeService.instance ??= new VoucherCodeService());
  }

  async getApplicableVoucherCodes({
    customerId,
    orderAmount,
    storeId,
    productIds,
    skip = 0,
    limit = 1000,
  }: GetApplicableVoucherCodesParams): Promise<ApplicableVoucherCodeResult[]> {
    try {
      const cacheKey = `${this.CUSTOMER_CODES_KEY}${customerId}`;
      let customerCodes = await redis.get(cacheKey);
      if (!customerCodes) {
        const codes = await prismaClient.code.findMany({
          where: {
            customerId,
            used: false,
            isExpired: false,
            expiredAt: { gte: Date.now() },
          },
          include: {
            voucherInfo: {
              select: {
                id: true,
                name: true,
                thumb: true,
                isActive: true,
                endDate: true,
                minAmountPayment: true,
                voucherTypeDiscount: true,
                valueDiscount: true,
                valuePercentDiscount: true,
                valueMaxDiscount: true,
              },
            },
          },
        });

        await redis.set(
          cacheKey,
          JSON.stringify(codes),
          'EX',
          300 // 5 minutes cache
        );
        customerCodes = JSON.stringify(codes);
      }

      const codes = JSON.parse(customerCodes);
      const pipeline = redis.multi();

      // Batch check for used status and locks
      codes.forEach((code: any) => {
        // Check if code is being used in an order
        pipeline.get(`${this.CODE_LOCK_KEY}${code.id}`);
      });

      const results = await pipeline.exec();
      let resultIndex = 0;

      const applicableVouchers: ApplicableVoucherCodeResult[] = [];

      for (const codeInfo of codes) {
        // Check if code is locked (being used in an order)
        const isLocked = results?.[resultIndex++][1];

        if (isLocked) continue;

        // Validate voucher conditions
        if (!this.isVoucherValid(codeInfo, orderAmount, storeId, productIds)) {
          continue;
        }

        // Calculate discount
        const discountAmount = this.calculateDiscount(
          orderAmount || 0,
          codeInfo.voucherInfo
        );

        applicableVouchers.push({
          code: codeInfo.code!,
          expiredAt: codeInfo.expiredAt,
          discountAmount: Math.round(discountAmount),
          voucherInfo: {
            id: codeInfo.voucherInfo.id,
            name: codeInfo.voucherInfo.name,
            thumb: codeInfo.voucherInfo.thumb,
            voucherTypeDiscount: codeInfo.voucherInfo.voucherTypeDiscount,
            valueDiscount: codeInfo.voucherInfo.valueDiscount,
            valuePercentDiscount: codeInfo.voucherInfo.valuePercentDiscount,
            valueMaxDiscount: codeInfo.voucherInfo.valueMaxDiscount,
            minAmountPayment: codeInfo.voucherInfo.minAmountPayment,
            endDate: Number(codeInfo.voucherInfo.endDate),
          },
        });
      }

      // Sort by discount amount
      const sortedVouchers = orderAmount
        ? applicableVouchers.sort(
            (a, b) => b.discountAmount! - a.discountAmount!
          )
        : applicableVouchers.sort((a, b) => b.expiredAt - a.expiredAt);

      return sortedVouchers.slice(skip, limit);
    } catch (error) {
      console.error('Error getting applicable vouchers:', error);
      return [];
    }
  }

  async validateVoucherCode(
    customerId: number,
    code: string,
    orderAmount?: number
  ): Promise<ValidationResult> {
    const voucherDetails = await redis.get(`voucher:${code}`);
    let details;
    if (!voucherDetails) {
      details = await prismaClient.code.findFirst({
        where: {
          code,
          customerId,
          used: false,
          isExpired: false,
          expiredAt: { gte: Date.now() },
        },
        include: {
          voucherInfo: {
            select: {
              id: true,
              isActive: true,
              endDate: true,
              minAmountPayment: true,
              voucherTypeDiscount: true,
              valueDiscount: true,
              valuePercentDiscount: true,
              valueMaxDiscount: true,
            },
          },
        },
      });
      if (!details) {
        return {
          isValid: false,
          errorCode: VoucherErrorCode.INVALID,
          error: 'Mã voucher không tồn tại hoặc đã hết hạn',
        };
      }
      await redis.set(`voucher:${code}`, JSON.stringify(details), 'EX', 300);
    } else {
      details = JSON.parse(voucherDetails);
      if (details.customerId !== customerId) {
        return {
          isValid: false,
          errorCode: VoucherErrorCode.INVALID,
          error: 'Mã voucher không hợp lệ',
        };
      }
    }

    // Check if code is already used
    if (details.used) {
      return {
        isValid: false,
        errorCode: VoucherErrorCode.ALREADY_USED,
        error: 'Mã voucher đã được sử dụng',
      };
    }

    if (orderAmount && details.voucherInfo.minAmountPayment) {
      if (orderAmount < details.voucherInfo.minAmountPayment) {
        return {
          isValid: false,
          errorCode: VoucherErrorCode.RULE_VIOLATION,
          error: `Giá trị đơn hàng tối thiểu ${details.voucherInfo.minAmountPayment}đ`,
        };
      }
    }

    let discountAmount = 0;
    if (orderAmount) {
      switch (details.voucherInfo.voucherTypeDiscount) {
        case VoucherTypeDiscount.PERCENT:
          discountAmount =
            (orderAmount * (details.voucherInfo.valuePercentDiscount || 0)) /
            100;
          break;
        case VoucherTypeDiscount.VALUE:
          discountAmount =
            orderAmount > details.voucherInfo.valueDiscount
              ? details.voucherInfo.valueDiscount
              : orderAmount;
          break;
      }

      if (
        details.voucherInfo.valueMaxDiscount &&
        discountAmount > details.voucherInfo.valueMaxDiscount
      ) {
        discountAmount = details.voucherInfo.valueMaxDiscount;
      }
    }

    return {
      isValid: true,
      discountAmount: Math.round(discountAmount),
      voucherInfo: details.voucherInfo,
    };
  }

  async lockCodeForOrder(code: string, orderId: string): Promise<boolean> {
    const codeInfo = await prismaClient.code.findFirst({
      where: { code },
    });

    if (!codeInfo) return false;

    const lockKey = `${this.CODE_LOCK_KEY}${codeInfo.id}`;
    const locked = await redis.set(lockKey, orderId, 'EX', 300, 'NX'); // 5 minutes lock

    return locked === 'OK';
  }

  async useCodeInOrder(
    code: string,
    orderId: string,
    customerId: number
  ): Promise<boolean> {
    try {
      const codeInfo = await prismaClient.code.findFirst({
        where: {
          code,
          customerId,
          used: false,
          isExpired: false,
          expiredAt: { gte: Date.now() },
        },
        include: {
          voucherInfo: true,
        },
      });

      if (!codeInfo) {
        return false;
      }

      // Check if code is locked for this order
      const lockKey = `${this.CODE_LOCK_KEY}${codeInfo.id}`;
      const lockedOrderId = await redis.get(lockKey);

      if (!lockedOrderId || lockedOrderId !== orderId) {
        return false;
      }

      // Update code as used in transaction
      await prismaClient.$transaction([
        prismaClient.code.update({
          where: { id: codeInfo.id },
          data: {
            used: true,
            usedAt: Date.now(),
            orderId,
            timeToLive: moment().add(3, 'day').valueOf(),
          },
        }),
      ]);

      // Remove lock from Redis
      await redis.del(lockKey);

      // Update Redis cache
      await redis.del(`${this.CUSTOMER_CODES_KEY}${customerId}`);

      return true;
    } catch (error) {
      console.error('Error using code in order:', error);
      return false;
    }
  }

  async cancelCodeInOrder(code: string, orderId: string): Promise<boolean> {
    try {
      const codeInfo = await prismaClient.code.findFirst({
        where: {
          code,
          orderId,
          used: true,
        },
      });

      if (!codeInfo) {
        return false;
      }

      // Reset code status in transaction
      await prismaClient.$transaction([
        prismaClient.code.update({
          where: { id: codeInfo.id },
          data: {
            used: false,
            usedAt: null,
            orderId: null,
            timeToLive: null,
          },
        }),
      ]);

      // Update Redis cache
      await redis.del(`${this.CUSTOMER_CODES_KEY}${codeInfo.customerId}`);

      return true;
    } catch (error) {
      console.error('Error canceling code in order:', error);
      return false;
    }
  }

  async unlockCode(code: string): Promise<void> {
    const codeInfo = await prismaClient.code.findFirst({
      where: { code },
    });

    if (codeInfo) {
      await redis.del(`${this.CODE_LOCK_KEY}${codeInfo.id}`);
    }
  }

  async isCodeLocked(code: string): Promise<boolean> {
    const codeInfo = await prismaClient.code.findFirst({
      where: { code },
    });

    if (!codeInfo) return false;

    const lockExists = await redis.exists(
      `${this.CODE_LOCK_KEY}${codeInfo.id}`
    );
    return lockExists === 1;
  }

  async claimCodeVoucher(
    voucherInfo: any,
    customerId: number
  ): Promise<{
    success: boolean;
    message: string;
    code?: string;
    performance?: any;
  }> {
    const startTime = performance.now();
    const metrics: any = {};

    const lockKey = `voucher:${voucherInfo.id}:${customerId}`;

    try {
      // Acquire lock with backoff strategy
      let lockAttempts = 0;
      while (lockAttempts < 3) {
        if (await this.acquireLock(lockKey)) {
          break;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * Math.pow(2, lockAttempts))
        );
        lockAttempts++;
      }

      if (lockAttempts === 3) {
        return {
          success: false,
          message: 'Hệ thống bận, vui lòng thử lại sau',
        };
      }

      metrics.lockTime = performance.now() - startTime;

      // Start transaction with timeout
      return await prismaClient.$transaction(
        async (tx) => {
          const txStartTime = performance.now();

          // Get voucher with cache
          const voucher = await this.voucherDistribution.getVoucherWithCache(
            voucherInfo.id,
            tx
          );
          metrics.voucherFetchTime = performance.now() - txStartTime;

          if (!voucher || !voucher.isActive || !voucher.isApprove) {
            return {
              success: false,
              message: 'Voucher không tồn tại hoặc không hoạt động',
            };
          }

          // Check limits using Redis for counting
          const limitsStartTime = performance.now();
          const [totalUsage, userUsage] = await Promise.all([
            redis.get(`voucher:${voucherInfo.id}:total`),
            redis.get(`voucher:${voucherInfo.id}:user:${customerId}`),
          ]);

          // Validate limits

          if (
            this.isLimitExceeded(
              voucher.limiter,
              parseInt(totalUsage || '0'),
              parseInt(userUsage || '0')
            )
          ) {
            return {
              success: false,
              message: 'Voucher đã đến giới hạn, không thể nhận',
            };
          }

          metrics.limitsCheckTime = performance.now() - limitsStartTime;

          // Get pre-generated code
          const codeStartTime = performance.now();
          const code = await this.getNextCode(voucherInfo.id);

          let expiredAt = voucher.endDate;
          if (voucher.codeTimeType && voucher.codeTime) {
            const codeTime = voucher.codeTime ? Number(voucher.codeTime) : 0;
            switch (voucher.codeTimeType) {
              case 'DAYS':
                expiredAt = moment().add(codeTime, 'day').valueOf();
                break;
              case 'DATE':
                expiredAt = moment().add(codeTime).valueOf();
                break;
            }
          }
          metrics.codeGenTime = performance.now() - codeStartTime;

          // Create voucher code in database
          const dbStartTime = performance.now();
          const dbOperations = [
            tx.code.create({
              data: {
                code,
                voucherId: voucherInfo.id,
                customerId,
                used: false,
                isExpired: false,
                expiredAt: expiredAt,
                voucherName: voucher.name,
                price: voucher.price || 0,
                thumb: voucher.thumb || '',
                imagesVoucher: voucher.imagesVoucher || [],
              },
            }),
            tx.$executeRaw`
            UPDATE limiter 
            SET 
              "updatedAt" = ${BigInt(Date.now())},
              purchased = purchased + 1,
              remaining = CASE 
                WHEN ${voucher.limiter?.limitProgram} != -1 
                THEN remaining - 1 
                ELSE remaining 
              END
            WHERE "voucherId" = ${voucherInfo.id}`,
          ];
          const [voucherCode, _] = (await Promise.all(dbOperations)) as [
            {
              id: number;
              code: string | null;
              expiredAt: number;
            },
            any,
          ];
          metrics.dbWriteTime = performance.now() - dbStartTime;
          metrics.totalTime = performance.now() - startTime;

          // Update Redis atomically
          await redis
            .multi()
            .incr(`voucher:${voucherInfo.id}:total`)
            .incr(`voucher:${voucherInfo.id}:user:${customerId}`)
            .exec();

          return {
            success: true,
            message: 'Nhận voucher thành công',
            code: voucherCode.code || undefined,
            expiredAt: voucherCode.expiredAt || undefined,
            performance: metrics,
          };
        },
        {
          timeout: 5000, // 5 second timeout
        }
      );
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  async exchangeCodeVoucher(
    voucherInfo: any,
    integrationId: number,
    integrationName: string
  ): Promise<{
    success: boolean;
    message: string;
    codeId?: number;
    code?: string;
    performance?: any;
  }> {
    const startTime = performance.now();
    const metrics: any = {};

    const lockKey = `voucher_exchange:${voucherInfo.id}:${integrationId}`;

    try {
      // Acquire lock with backoff strategy
      let lockAttempts = 0;
      while (lockAttempts < 3) {
        if (await this.acquireLock(lockKey)) {
          break;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * Math.pow(2, lockAttempts))
        );
        lockAttempts++;
      }

      if (lockAttempts === 3) {
        return {
          success: false,
          message: 'Hệ thống bận, vui lòng thử lại sau',
        };
      }

      metrics.lockTime = performance.now() - startTime;

      // Start transaction with timeout
      return await prismaClient.$transaction(
        async (tx) => {
          const txStartTime = performance.now();

          // Get voucher with cache
          const voucher = await this.voucherDistribution.getVoucherWithCache(
            voucherInfo.id,
            tx
          );
          metrics.voucherFetchTime = performance.now() - txStartTime;

          if (!voucher || !voucher.isActive || !voucher.isApprove) {
            return {
              success: false,
              message: 'Voucher không tồn tại hoặc không hoạt động',
            };
          }

          // Check limits using Redis for counting
          const limitsStartTime = performance.now();
          const [totalUsage, userUsage] = await Promise.all([
            redis.get(`voucher:${voucherInfo.id}:total`),
            redis.get(`voucher:${voucherInfo.id}:exchange:${integrationId}`),
          ]);

          // Validate limits
          if (
            this.isLimitExceeded(
              voucher.limiter,
              parseInt(totalUsage || '0'),
              parseInt(userUsage || '0')
            )
          ) {
            return {
              success: false,
              message: 'Voucher đã đến giới hạn, không thể nhận',
            };
          }

          metrics.limitsCheckTime = performance.now() - limitsStartTime;

          // Get pre-generated code
          const codeStartTime = performance.now();
          const code = await this.getNextCode(voucherInfo.id);

          let expiredAt = voucher.endDate;
          if (voucher.codeTimeType && voucher.codeTime) {
            const codeTime = voucher.codeTime ? Number(voucher.codeTime) : 0;
            switch (voucher.codeTimeType) {
              case 'DAYS':
                expiredAt = moment().add(codeTime, 'day').valueOf();
                break;
              case 'DATE':
                expiredAt = moment().add(codeTime).valueOf();
                break;
            }
          }

          metrics.codeGenTime = performance.now() - codeStartTime;

          // Create voucher code in database
          const dbStartTime = performance.now();
          const dbOperations = [
            tx.code.create({
              data: {
                code,
                integrationId: integrationId,
                integrationName: integrationName,
                voucherId: voucherInfo.id,
                used: false,
                isExpired: false,
                expiredAt: expiredAt,
                voucherName: voucher.name,
                price: voucher.price || 0,
                thumb: voucher.thumb || '',
                imagesVoucher: voucher.imagesVoucher || [],
              },
            }),
            tx.$executeRaw`
              UPDATE limiter 
              SET 
                "updatedAt" = ${BigInt(Date.now())},
                purchased = purchased + 1,
                remaining = CASE 
                  WHEN ${voucher.limiter?.limitProgram} != -1 
                  THEN remaining - 1 
                  ELSE remaining 
                END
              WHERE "voucherId" = ${voucherInfo.id}`,
          ];
          const [voucherCode, _] = (await Promise.all(dbOperations)) as [
            {
              id: number;
              code: string | null;
              expiredAt: number;
            },
            any,
          ];
          metrics.dbWriteTime = performance.now() - dbStartTime;
          metrics.totalTime = performance.now() - startTime;

          // Update Redis atomically
          await redis
            .multi()
            .incr(`voucher:${voucherInfo.id}:total`)
            .incr(`voucher:${voucherInfo.id}:exchange:${integrationId}`)
            .exec();

          return {
            success: true,
            message: 'success',
            codeId: voucherCode.id,
            code: voucherCode.code || undefined,
            expiredAt: voucherCode.expiredAt || undefined,
            performance: metrics,
          };
        },
        {
          timeout: 5000, // 5 second timeout
        }
      );
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  // ----------------- function private -------------------
  private async preFillCodePool(poolKey: string): Promise<void> {
    const voucherId = parseInt(poolKey.split(':')[1]);
    const prefix = voucherId
      .toString(36)
      .toUpperCase()
      .padStart(this.CODE_PREFIX_LENGTH, '0');

    const existingRedisCodes = new Set(await redis.lrange(poolKey, 0, -1));

    const codes = new Set<string>();
    const pipeline = redis.pipeline();
    let attempts = 0;
    const maxAttempts = VoucherCodeService.BATCH_SIZE * 2;

    while (
      codes.size < VoucherCodeService.BATCH_SIZE &&
      attempts < maxAttempts
    ) {
      attempts++;

      const timestamp = process.hrtime
        .bigint()
        .toString(36)
        .slice(-6)
        .toUpperCase();
      const random = crypto.randomBytes(4).toString('hex').toUpperCase();
      const code = `${prefix}${timestamp}${random}`.slice(0, this.CODE_LENGTH);

      if (!existingRedisCodes.has(code) && !codes.has(code)) {
        codes.add(code);
        pipeline.lpush(poolKey, code);

        pipeline.sadd('voucher:pending_codes', code);
      }
    }

    if (codes.size < VoucherCodeService.BATCH_SIZE) {
      console.warn(
        `Could only generate ${codes.size} unique codes after ${attempts} attempts`
      );
    }

    await pipeline.exec();

    this.verifyPendingCodes().catch(console.error);
  }

  private async verifyPendingCodes(): Promise<void> {
    const batchSize = 1000;

    while (true) {
      // Get a batch of pending codes
      const pendingCodes = await redis.spop('voucher:pending_codes', batchSize);
      if (!pendingCodes || pendingCodes.length === 0) break;

      try {
        // Check for duplicates in database
        const duplicates = await prismaClient.code.findMany({
          where: {
            code: {
              in: pendingCodes,
            },
          },
          select: { code: true },
        });

        if (duplicates.length > 0) {
          // Remove duplicates from Redis pools
          const pipeline = redis.pipeline();
          for (const { code } of duplicates) {
            if (code) {
              pipeline.lrem(`voucher:*:code_pool`, 0, code);
            }
          }
          await pipeline.exec();

          console.warn(`Removed ${duplicates.length} duplicate codes`);
        }
      } catch (error) {
        console.error('Error verifying pending codes:', error);
      }
    }
  }

  private async getNextCode(voucherId: number): Promise<string> {
    const poolKey = `voucher:${voucherId}:code_pool`;
    let code = await redis.rpop(poolKey);

    // Refill pool if empty
    if (!code) {
      await this.preFillCodePool(poolKey);
      code = await redis.rpop(poolKey);
    }

    // Verify code is unique in database
    const exists = await prismaClient.code.findFirst({
      where: { code },
      select: { id: true },
    });

    if (exists) {
      return this.getNextCode(voucherId);
    }

    return code!;
  }

  private async acquireLock(lockKey: string): Promise<boolean> {
    // Using SET NX with shorter TTL for high concurrency
    const acquired = await redis.set(`lock:${lockKey}`, '1', 'EX', 10, 'NX');
    return acquired === 'OK';
  }

  private async releaseLock(lockKey: string): Promise<void> {
    await redis.del(`lock:${lockKey}`);
  }

  private isLimitExceeded(
    limiter: any,
    totalUsage: number,
    userUsage: number
  ): boolean {
    if (limiter.limitProgram !== -1 && totalUsage > limiter.limitProgram) {
      return true;
    }

    if (limiter.limitProgram !== -1 && userUsage > limiter.limitUserProgram) {
      return true;
    }

    return false;
  }

  // Helper method to validate a voucher code

  private isVoucherValid(
    codeInfo: any,
    orderAmount?: number,
    storeId?: number,
    productIds?: number[]
  ): boolean {
    const voucherInfo = codeInfo.voucherInfo;

    // Check if voucher is still active
    if (!voucherInfo.isActive || voucherInfo.endDate < Date.now()) {
      return false;
    }

    // Check store restriction
    if (storeId && voucherInfo.storeId && voucherInfo.storeId !== storeId) {
      return false;
    }

    // Check product restriction
    if (voucherInfo.productIdsApply?.length > 0 && productIds) {
      const hasMatchingProduct = productIds.some((id) =>
        voucherInfo.productIdsApply.includes(id)
      );
      if (!hasMatchingProduct) {
        return false;
      }
    }

    // Check minimum order amount
    if (
      voucherInfo.minAmountPayment &&
      orderAmount &&
      orderAmount < voucherInfo.minAmountPayment
    ) {
      return false;
    }

    return true;
  }

  private calculateDiscount(orderAmount: number, voucherInfo: any): number {
    let discountAmount = 0;

    if (voucherInfo.voucherTypeDiscount === 1) {
      // Percentage
      discountAmount =
        (orderAmount * (voucherInfo.valuePercentDiscount || 0)) / 100;
    } else if (voucherInfo.voucherTypeDiscount === 2) {
      // Fixed
      discountAmount = voucherInfo.valueDiscount || 0;
    }

    // Apply maximum discount if applicable
    if (
      voucherInfo.valueMaxDiscount &&
      discountAmount > voucherInfo.valueMaxDiscount
    ) {
      discountAmount = voucherInfo.valueMaxDiscount;
    }

    return discountAmount;
  }
}
