import { prismaClient } from '../utils/prisma';
import redis from '@root/src/utils/redis';

export const bannerService = {
    getAllBanners: async () => {
        const data = await redis.get('banner');
        if (data) return JSON.parse(data);
        const banner = await prismaClient.banner.findMany({
            where: { isActive: true },
            orderBy: { sequence: 'desc' },
        });
        await redis.set('banner', JSON.stringify(banner));
        return banner;
    },

    refreshCache: async () => {
        try {
            console.log('refreshCache banner');
            const banner = await prismaClient.banner.findMany({
                where: { isActive: true },
                orderBy: { sequence: 'desc' },
            });
            await redis.set('banner', JSON.stringify(banner));
        } catch (error) {
            console.log(
                '🚀 ~ file: banner.service.ts:142 ~ refreshLocalCache: ~ error:',
                error
            );
        }
    },

    bootstrap: async () => {
        await bannerService.refreshCache();
    },

    beforeUpdate: async (instance: any) => {
        try {
            if(instance.actionData) {
                const { actionData } = instance;
                instance.actionData = String(actionData);
            }
        } catch (error) {
            console.log(error);
        }
        return instance;
    },

    beforeCreate: async (instance: any) => {
        try {
            if(instance.actionData) {
                const { actionData } = instance;
                instance.actionData = String(actionData);
            }
        } catch (error) {
            console.log(error);
        }
        return instance;
    },

    runCronjob5: async () => {
        await bannerService.refreshCache();
    },
};
export default bannerService;
