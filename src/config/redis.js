const Redis = require('ioredis');

let redis;
let redisAvailable = false;

// In-memory fallback store
const memoryStore = new Map();
const rateLimitStore = new Map();

async function initRedis() {
  try {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      retryStrategy: (times) => {
        if (times > 3) {
          console.log('⚠️ Redis not available, using in-memory fallback');
          return null;
        }
        return Math.min(times * 100, 1000);
      },
      maxRetriesPerRequest: 1,
    });

    await redis.ping();
    redisAvailable = true;
    console.log('✅ Redis connected');
  } catch (error) {
    console.log('⚠️ Redis unavailable, using in-memory fallback');
    redisAvailable = false;
  }
  
  return { redis, redisAvailable, memoryStore, rateLimitStore };
}

// Get Redis client (or fallback)
async function getRedis() {
  if (!redis) {
    await initRedis();
  }
  return { redis, redisAvailable, memoryStore, rateLimitStore };
}

module.exports = { initRedis, getRedis };