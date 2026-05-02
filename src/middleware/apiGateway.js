const Redis = require('ioredis');
const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const Api = require('../models/Api');
const UsageLog = require('../models/UsageLog');
const Billing = require('../models/Billing');
const moment = require('moment');

// --- In-Memory Cache Fallback ---
const memoryCache = new Map();

// --- Try to connect to Redis once, but don't crash if it fails ---
let redis = null;
let redisAvailable = false;

console.log('🔄 Initializing cache service...');

try {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  redis = new Redis(redisUrl, {
    retryStrategy: (times) => {
      if (times > 3) {
        console.warn('⚠️ Redis not available after multiple attempts, switching to in-memory cache fallback.');
        redisAvailable = false;
        return null; // Stop retrying
      }
      return Math.min(times * 100, 3000);
    },
    maxRetriesPerRequest: 1,
  });

  redis.on('connect', () => {
    console.log('✅ Redis cache connected successfully.');
    redisAvailable = true;
  });

  redis.on('error', (err) => {
    if (redisAvailable === false) return; // Avoid log spam
    console.warn('⚠️ Redis connection error:', err.message);
    redisAvailable = false;
  });
} catch (err) {
  console.warn('⚠️ Redis unavailable, using in-memory fallback. Error:', err.message);
  redisAvailable = false;
}
// ---------------------------------

class APIGateway {
  constructor() {
    this.rateLimitPrefix = 'rate_limit:';
    this.keyCachePrefix = 'api_key:';
  }

  async validateApiKey(apiKey) {
    const cacheKey = `${this.keyCachePrefix}${apiKey}`;
    
    // Try to get from cache (Redis or In-Memory)
    if (redisAvailable) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch (err) {}
    } else {
      const cached = memoryCache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        return cached.data;
      } else if (cached) {
        memoryCache.delete(cacheKey);
      }
    }

    // Fetch from DB on cache miss
    const keyDoc = await ApiKey.findOne({ key: apiKey, status: 'active' })
      .populate('apiId');
    
    if (!keyDoc) return null;
    if (keyDoc.expiresAt && keyDoc.expiresAt < new Date()) return null;

    const keyData = {
      id: keyDoc._id,
      apiId: keyDoc.apiId._id,
      consumerId: keyDoc.consumerId,
      baseUrl: keyDoc.apiId.baseUrl,
      apiName: keyDoc.apiId.name,
      pricing: keyDoc.apiId.pricing,
      rateLimit: {
        perMinute: keyDoc.rateLimit?.perMinute || keyDoc.apiId.rateLimit.perMinute,
        perHour: keyDoc.rateLimit?.perHour || keyDoc.apiId.rateLimit.perHour,
        perDay: keyDoc.rateLimit?.perDay || keyDoc.apiId.rateLimit.perDay
      }
    };

    // Store in cache
    const ttl = 300; // 5 minutes
    if (redisAvailable) {
      await redis.setex(cacheKey, ttl, JSON.stringify(keyData));
    } else {
      memoryCache.set(cacheKey, {
        data: keyData,
        expiry: Date.now() + (ttl * 1000)
      });
    }
    return keyData;
  }

  async checkRateLimit(keyId, consumerId, limits) {
    // If Redis is not available, skip rate limiting entirely.
    if (!redisAvailable) return { allowed: true };

    const now = new Date();
    const minuteKey = `${this.rateLimitPrefix}${keyId}:minute:${Math.floor(now.getTime() / 60000)}`;
    const hourKey = `${this.rateLimitPrefix}${keyId}:hour:${Math.floor(now.getTime() / 3600000)}`;
    const dayKey = `${this.rateLimitPrefix}${keyId}:day:${Math.floor(now.getTime() / 86400000)}`;

    try {
      const [minuteCount, hourCount, dayCount] = await Promise.all([
        redis.incr(minuteKey),
        redis.incr(hourKey),
        redis.incr(dayKey)
      ]);
      if (minuteCount === 1) await redis.expire(minuteKey, 60);
      if (hourCount === 1) await redis.expire(hourKey, 3600);
      if (dayCount === 1) await redis.expire(dayKey, 86400);

      if (minuteCount > limits.perMinute) return { allowed: false, limit: 'perMinute', retryAfter: 60 };
      if (hourCount > limits.perHour) return { allowed: false, limit: 'perHour', retryAfter: 3600 };
      if (dayCount > limits.perDay) return { allowed: false, limit: 'perDay', retryAfter: 86400 };
    } catch (err) {
      console.warn('⚠️ Rate limit check failed, allowing request:', err.message);
    }
    return { allowed: true };
  }

  async logRequestAndGenerateBill(logData) {
    try {
      const log = new UsageLog(logData);
      await log.save();
      await ApiKey.findByIdAndUpdate(logData.apiKey, { lastUsedAt: new Date() });
      await this.updateBillingRecord(logData);
    } catch (error) {
      console.error('Error logging request:', error);
    }
  }

  async updateBillingRecord(logData) {
    try {
      const periodStart = moment().startOf('month').toDate();
      const periodEnd = moment().endOf('month').toDate();
      const api = await Api.findById(logData.apiId);
      if (!api) return;
      
      const freeTier = api.pricing?.freeTier || 1000;
      const perRequestPrice = api.pricing?.perRequestPrice || 0.001;
      
      const totalRequests = await UsageLog.countDocuments({
        consumerId: logData.consumerId,
        apiId: logData.apiId,
        timestamp: { $gte: periodStart, $lte: periodEnd }
      });
      
      const paidRequests = Math.max(0, totalRequests - freeTier);
      const amount = paidRequests * perRequestPrice;
      
      let billing = await Billing.findOne({
        consumerId: logData.consumerId,
        apiId: logData.apiId,
        'period.start': periodStart,
        'period.end': periodEnd
      });
      
      if (!billing) {
        billing = new Billing({
          consumerId: logData.consumerId,
          apiId: logData.apiId,
          period: { start: periodStart, end: periodEnd },
          totalRequests,
          paidRequests,
          amount: parseFloat(amount.toFixed(2)),
          currency: api.pricing?.currency || 'USD',
          status: amount > 0 ? 'pending' : 'paid',
          dueDate: amount > 0 ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
          paidAt: amount === 0 ? new Date() : null
        });
      } else {
        billing.totalRequests = totalRequests;
        billing.paidRequests = paidRequests;
        billing.amount = parseFloat(amount.toFixed(2));
        billing.status = amount > 0 ? 'pending' : 'paid';
        if (amount === 0) billing.paidAt = new Date();
      }
      await billing.save();
    } catch (error) {
      console.error('Error updating billing:', error);
    }
  }

  async forwardRequest(targetUrl, reqBody, headers, method) {
    const axios = require('axios');
    try {
      const response = await axios({
        method,
        url: targetUrl,
        data: reqBody,
        headers: { ...headers, 'x-forwarded-by': 'MeterFlow-Gateway' },
        timeout: 30000
      });
      return response;
    } catch (error) {
      return error.response || { status: 500, data: { error: 'Gateway error' } };
    }
  }
}

const gatewayMiddleware = async (req, res, next) => {
  const gateway = new APIGateway();
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'API key required' });

    const keyData = await gateway.validateApiKey(apiKey);
    if (!keyData) return res.status(401).json({ error: 'Invalid or inactive API key' });

    const rateLimitCheck = await gateway.checkRateLimit(keyData.id, keyData.consumerId, keyData.rateLimit);
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        error: `Rate limit exceeded (${rateLimitCheck.limit})`,
        retryAfter: rateLimitCheck.retryAfter
      });
    }

    req.gateway = { keyData, apiKey, startTime: Date.now() };
    next();
  } catch (error) {
    console.error('Gateway error:', error);
    res.status(500).json({ error: 'Gateway processing error' });
  }
};

const proxyMiddleware = async (req, res) => {
  const gateway = new APIGateway();
  const { keyData, apiKey, startTime } = req.gateway;
  const targetUrl = `${keyData.baseUrl}${req.originalUrl}`;
  const response = await gateway.forwardRequest(targetUrl, req.body, req.headers, req.method);
  const responseTime = Date.now() - startTime;
  const cost = keyData.pricing?.perRequestPrice || 0.001;
  
  await gateway.logRequestAndGenerateBill({
    apiKey, apiId: keyData.apiId, consumerId: keyData.consumerId,
    endpoint: req.originalUrl, method: req.method, statusCode: response.status,
    responseTime, ipAddress: req.ip, userAgent: req.headers['user-agent'], cost
  });
  
  res.setHeader('X-Request-Cost', `$${cost}`);
  res.status(response.status).json(response.data);
};

module.exports = { gatewayMiddleware, proxyMiddleware, APIGateway };