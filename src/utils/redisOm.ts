import ConfigSystem from '@src/config/config';
import { createClient } from 'redis';

const redisClientOm = createClient({
  database: Number(ConfigSystem.REDISEARCH_CONFIG.db),
  password: ConfigSystem.REDISEARCH_CONFIG.password,
  socket: {
    host: ConfigSystem.REDISEARCH_CONFIG.host,
    port: Number(ConfigSystem.REDISEARCH_CONFIG.port),
  },
});

redisClientOm
  .connect()
  .then(() => {
    console.log('🚀 Redisearch ===> Ok!');
  })
  .catch((error: Error) =>
    console.error('🚀 RedisSearch client error:', error)
  );

redisClientOm.on('error', (err: any) => {
  console.error('🚀 RedisSearch client error:', err);
});

redisClientOm.on('reconnecting', () => {
  console.log('🚀 RedisSearch client reconnecting...');
});

export default redisClientOm;
