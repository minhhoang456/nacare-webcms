import { prismaClient } from "../utils/prisma";
import redis from "../utils/redis";

export const depotService = {
  refreshCache: async () => {
    const cacheKey = "depot";
    const depot = await prismaClient.depot.findMany();
    if (depot.length === 0) {
      return;
    }
    await redis.set(cacheKey, JSON.stringify(depot));
  },

  bootstrap: async () => {
    setTimeout(async () => {
      await depotService.refreshCache();
    }, 5000);
  },

  runCronjob1Hour: async () => {
    await depotService.refreshCache();
  },
};
export default depotService;
