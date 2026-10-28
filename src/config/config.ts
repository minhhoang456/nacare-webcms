export default class Config {
  public static REDIS_CONFIG = {
    host: process.env.REDIS_HOST || "167.71.211.104",
    port: Number(process.env.REDIS_PORT) || 6379,
    db: Number(process.env.REDIS_DB) || 0,
    password: process.env.REDIS_PASSWORD || "",
    keyPrefix: process.env.REDIS_PREFIX || "nacare-dev:",
  };

  public static REDISEARCH_CONFIG = {
    host: process.env.REDISEARCH_HOST || "167.71.211.104",
    port: process.env.REDISEARCH_PORT || 6379,
    db: process.env.REDISEARCH_DB || 0,
    password: process.env.REDISEARCH_PASSWORD || "",
    prefix: process.env.REDIS_PREFIX || "nacare-dev:",
  };

  public static ELASTICSEARCH_CONFIG = {
    node: process.env.ELASTICSEARCH_NODE || "http://localhost:9200",
    username: process.env.ELASTICSEARCH_USERNAME || "elastic",
    password: process.env.ELASTICSEARCH_PASSWORD || "namtruong",
    prefix: process.env.ELASTICSEARCH_PREFIX || "vds-dev",
  };

  public static MONGO_DB_URL =
    process.env.MONGO_DB_URL || "mongodb://localhost:27017/nacare-chat";
}
