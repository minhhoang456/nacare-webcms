import { prismaClient } from '../utils/prisma';
import redis from '../utils/redis';
export const policyService = {
  bootstrap: async () => {
    policyService.refreshCache();
  },

  runCronjob5: async () => {
    policyService.refreshCache();
  },

  async refreshCache() {
    try {
      const policies = await policyService.getPolicyFromDb();
      if (policies.length === 0) return;
      const groupedType = policies.reduce((acc: any, e: any) => {
        acc[e.type] = acc[e.type] || [];
        acc[e.type].push(e);
        return acc;
      }, {});

      Object.values(groupedType).forEach((arr: any) => {
        arr.sort((a: any, b: any) => a.sequence - b.sequence);
      });

      const result = Object.entries(groupedType).map(([key, value]: any) => ({
        name: key,
        data: value
      }));

      const pipeline = redis.pipeline();
      pipeline.set(`policy__all_type`, JSON.stringify(result));
      policies.map((policy) => {
        pipeline.hset(
          `policy_id_V3`,
          policy.id,
          JSON.stringify(policy)
        );
      });
      await pipeline.exec();
    } catch (error) {
    }
  },

  beforeCreate: async (instance: any) => {
    try {
      if (instance.type) {
        const match = instance.type.match(/\d+$/);
        const number = match ? parseInt(match[0], 10) : null;
        instance.sequenceType = number;
        instance.type = instance.type.replace(/\d+$/, '');
      }
    } catch (error) {
      console.log(error);
    }
    return instance;
  },

  beforeUpdate: async (instance: any) => {
    try {
      if (instance.type) {
        const match = instance.type.match(/\d+$/);
        const number = match ? parseInt(match[0], 10) : null;
        instance.sequenceType = number;
        instance.type = instance.type.replace(/-\s*\d+$/, '').trim();
      }
    } catch (error) {
      console.log(error);
    }
    return instance;
  },

  getPolicyType: async () => {
    const data = await redis.get('policy__all_type');
    if (data) {
      return JSON.parse(data);
    }
    const policies = await policyService.getPolicyFromDb();
    if (!policies.length) return [];
    await redis.set(`policy__all_type`, JSON.stringify(policies), 'EX', 60 * 2);
    return policies;
  },

  getPolicyDetail: async (id: string) => {
    const data = await redis.hget(`policy_id_V3`, id);
    if (data) {
      return JSON.parse(data);
    }
    const policy = await prismaClient.policy.findUnique({
      where: {
        id: Number(id)
      },
    })
    if (!policy) return;
    await redis.hset(`policy_id_V3`, id, JSON.stringify(policy));
    await redis.expire(`policy_id_V3`, 15);
    return policy;
  },

  getPolicyFromDb: async () => {
    const policies = await prismaClient.policy.findMany({
      orderBy: {
        sequenceType: 'asc',
      },
      omit: {
        createdAt: true,
        updatedAt: true,
      }
    });
    return policies;
  }
};
export default policyService;
