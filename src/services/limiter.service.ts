import { prismaClient } from '../utils/prisma';
import _ from 'lodash';
import ono from '@jsdevtools/ono';
const propsDefined: any = {
  limitProgram: 'Giới hạn toàn chương trình',
  limitUserProgram: 'Giới hạn voucher mỗi khách hàng trong toàn chương trình',
  limitDay: 'Giới hạn voucher trong ngày toàn chương trình',
  limitUserDay: 'Giới hạn trong ngày toàn trên mỗi khách hàng',
  limitHour: 'Giới hạn voucher toàn chương trình mỗi giờ',
  limitUserHour: 'Giới hạn voucher mỗi giờ cho mỗi khách hàng',
  limiterMonth: 'Giới hạn số lượng mua voucher trong tháng',
  limiterUserMonth: 'Giới hạn số lượng mua voucher mỗi khách hàng trong tháng',
};

export const limiterService = {
  validateData: async (data: any) => {
    const keys: string[] = Object.keys(data);
    for (const key of keys) {
      if (key in propsDefined && data[`${key}`] < -1) {
        throw ono(
          `"${propsDefined[key]}" must be greater than or equal to -1 (-1 is unlimited)`
        );
      }
    }
    return true;
  },
  beforeUpdate: async (inst: any) => {
    if (inst.limitProgram && inst.limitProgram > -1) {
      const voucherInfo = await prismaClient.voucher.findFirst({
        where: { id: inst.voucherId },
      });
      if (voucherInfo) {
        const codeCount = await prismaClient.code.count({
          where: { voucherId: voucherInfo.id },
        });
        if (codeCount > inst.limitProgram) {
          throw ono(
            `Voucher ${voucherInfo.name} has ${codeCount} codes, "Total quantity" must be greater than or equal to ${codeCount}`
          );
        }
      }
    }
    return inst;
  },

  addLimiterForVoucher: async (voucherId: number) => {
    let limiterInfo = await prismaClient.limiter.findFirst({
      where: {
        voucherId,
      },
    });
    if (limiterInfo) {
      return limiterInfo;
    }

    let [limiterCreated] = await Promise.all([
      prismaClient.limiter.create({
        data: { voucherId },
      }),
      prismaClient.voucher.update({
        where: { id: voucherId },
        data: { isApprove: true },
      }),
    ]);
    console.log(
      '🚀 ~ file: limiter.service.ts:118 ~ addLimiterForVoucher: ~ limiterInfo:',
      limiterCreated
    );
    return limiterCreated;
  },
};
export default limiterService;
