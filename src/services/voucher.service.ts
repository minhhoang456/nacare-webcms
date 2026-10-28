// import localCache from '../utils/localCache';
// import crypt from '../utils/crypt';
import VoucherDistributionService, {
  VoucherListResponse,
  VoucherDistributionResult,
} from '../utils/voucher.distribution';
import VoucherCodeService from '../utils/voucher.code';
export enum VoucherTypeDiscount {
  PERCENT = 2,
  VALUE = 1,
}

export const voucherService = {
  getKeyVoucherActive: (customerId: number) => `voucher_active:${customerId}`,

  getListVouchers: async ({
    skip,
    limit,
    customerId,
  }: {
    skip: number;
    limit: number;
    customerId: number;
  }): Promise<VoucherListResponse> => {
    return await VoucherDistributionService.getInstance().getCanClaimVouchers({
      skip,
      limit,
      customerId,
    });
  },

  // ----------------- function for claim voucher code -------------------

  customerClaimVoucher: async (
    voucherInfo: any,
    customerId: number
  ): Promise<VoucherDistributionResult> => {
    return await VoucherCodeService.getInstance().claimCodeVoucher(
      voucherInfo,
      customerId
    );
  },

  integrationClaimVoucher: async (
    voucherInfo: any,
    integrationId: number,
    integrationName: string
  ): Promise<VoucherDistributionResult> => {
    return await VoucherCodeService.getInstance().exchangeCodeVoucher(
      voucherInfo,
      integrationId,
      integrationName
    );
  },

  // ----------------- function for usage voucher code -------------------

  checkValidCode: async (
    customerId: number,
    code: string,
    orderAmount?: number
  ) => {
    return await VoucherCodeService.getInstance().validateVoucherCode(
      customerId,
      code,
      orderAmount
    );
  },

  lockCode: async (code: string, orderId: string) => {
    return await VoucherCodeService.getInstance().lockCodeForOrder(
      code,
      orderId
    );
  },

  unlockCode: async (code: string) => {
    return await VoucherCodeService.getInstance().unlockCode(code);
  },

  useCodeInOrder: async (code: string, customerId: number, orderId: string) => {
    return await VoucherCodeService.getInstance().useCodeInOrder(
      code,
      orderId,
      customerId
    );
  },

  rollbackVoucherUsage: async (code: string, orderId: string) => {
    return await VoucherCodeService.getInstance().cancelCodeInOrder(
      code,
      orderId
    );
  },

  // ----------------- function for voucher -------------------

  getVoucherInfoKey: (voucherId: number) => {
    return `voucher_info_${voucherId}`;
  },

  getVoucherInfoById: async (voucherId: number) => {
    return await VoucherDistributionService.getInstance().getVoucherWithCache(
      voucherId
    );
  },
};
export default voucherService;
