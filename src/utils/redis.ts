import Redis from 'ioredis';
import ConfigSystem from '@src/config/config';

const redis: Redis & { runMulti?: any; runKeys?: any; runDels?: any } =
  new Redis({
    ...ConfigSystem.REDIS_CONFIG,
    retryStrategy(times: number) {
      if (times <= 20) {
        return Math.min(times * 400, 10000);
      }
      console.error('Reached the max retries per request limit (which is 20)');
      return null;
    },
  });

redis.on('connect', () => {
  console.log('🚀 Redis ===> Ok!');
});

redis.on('error', (err) => {
  console.error('🚀 Redis client error:', err);
});

redis.on('reconnecting', () => {
  console.log('🚀 Redis client reconnecting...');
});

const redisSubscriber: Redis & { runKeys?: any; runDels?: any } = new Redis({
  ...ConfigSystem.REDIS_CONFIG,
  retryStrategy(times: number) {
    if (times <= 20) {
      return Math.min(times * 400, 10000);
    }
    console.error('Reached the max retries per request limit (which is 20)');
    return null;
  },
});

redis.runMulti = () => {
  const multi = redis.multi();
  const originalExec = multi.exec;
  multi.exec = function () {
    return originalExec
      .call(this)
      .then((results: [Error | null, unknown][] | null) => {
        if (!results) return null;
        results.forEach(([err, _]) => {
          if (err) throw err;
        });
        return results;
      });
  };
  return multi;
};

redis.runKeys = (key: string) => {
  return new Promise((resolve, reject) => {
    redis.keys(`${process.env.REDIS_PREFIX}${key}`).then(resolve).catch(reject);
  });
};

redis.runDels = (keys: string[]) => {
  if (process.env.REDIS_PREFIX) {
    keys = keys.map((e) => {
      return e.replace(process.env.REDIS_PREFIX as string, '');
    });
  }
  return new Promise((resolve, reject) => {
    redis.del(keys).then(resolve).catch(reject);
  });
};

export default redis;
export { redisSubscriber };
