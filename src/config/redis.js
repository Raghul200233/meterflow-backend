const memoryStore = new Map();
const rateLimitStore = new Map();

function getRedis() {
  const redis = global.redisClient || null;
  const redisAvailable = global.redisAvailable || false;

  if (!redisAvailable) {
  }

  return {
    redis,
    redisAvailable,
    memoryStore,
    rateLimitStore
  };
}

function clearMemoryCache() {
  memoryStore.clear();
  rateLimitStore.clear();
}

function getMemoryStats() {
  return {
    cacheSize: memoryStore.size,
    rateLimitEntries: rateLimitStore.size
  };
}

module.exports = {
  getRedis,
  memoryStore,
  rateLimitStore,
  clearMemoryCache,
  getMemoryStats
};