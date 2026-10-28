import { prismaClient } from '../utils/prisma';
import messagequeueService from './messagequeue';

export const codeService = {
  afterUpdate: async (inst: any) => {
    if (inst.used && inst.usedAt && inst.integrationId) {
      await messagequeueService.addEvent({
        action: 'sync_state_code_exchange',
        data: { codeInfo: inst },
      });
    }
  },
  getCodeInfo: async (code: string) => {
    try {
      const codeInfo = await prismaClient.code.findFirst({
        where: {
          code,
        },
      });
      if (!codeInfo) return null;
      if (codeInfo.customerId) return null;
      if (codeInfo.used) return null;
      if (codeInfo.expiredAt && codeInfo.expiredAt < Date.now()) return null;
      return codeInfo;
    } catch (error) {
      return null;
    }
  },
};
export default codeService;
