const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const Api = require('../models/Api');
const UsageLog = require('../models/UsageLog');
const Billing = require('../models/Billing');
const moment = require('moment');
const axios = require('axios');

// --- In-Memory Cache Fallback ---
const memoryCache = new Map();

class APIGateway {
  constructor() {
    this.rateLimitPrefix = 'rate_limit:';
    this.keyCachePrefix = 'api_key:';
  }

  // ✅ Always fetch latest Redis state (FIXED)
  getRedis() {
    return {
      redis: global.redisClient || null,
      redisAvailable: global.redisAvailable || false
    };
  }

  // -------------------------------
  // 🔐 API KEY VALIDATION + CACHE
  // -------------------------------
  async validateApiKey(apiKey) {
    const { redis, redisAvailable } = this.getRedis();
    const cacheKey = `${this.keyCachePrefix}${apiKey}`;

    // 🔹 Try Redis cache
    if (redisAvailable && redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch (err) {
        console.warn('Redis read failed, fallback to DB');
      }
    } else {
      // 🔹 Memory fallback
      const cached = memoryCache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) return cached.data;
      if (cached) memoryCache.delete(cacheKey);
    }

    // 🔹 DB lookup
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

    const ttl = 300;

    // 🔹 Store in Redis
    if (redisAvailable && redis) {
      try {
        await redis.setex(cacheKey, ttl, JSON.stringify(keyData));
      } catch (err) {
        console.warn('Redis write failed, using memory cache');
        memoryCache.set(cacheKey, {
          data: keyData,
          expiry: Date.now() + ttl * 1000
        });
      }
    } else {
      memoryCache.set(cacheKey, {
        data: keyData,
        expiry: Date.now() + ttl * 1000
      });
    }

    return keyData;
  }

  // -------------------------------
  // 🚦 RATE LIMITING
  // -------------------------------
  async checkRateLimit(keyId, consumerId, limits) {
    const { redis, redisAvailable } = this.getRedis();
    const now = Date.now();

    // ✅ Redis-based (Primary)
    if (redisAvailable && redis) {
      try {
        const minuteKey = `${this.rateLimitPrefix}${keyId}:m:${Math.floor(now / 60000)}`;
        const hourKey = `${this.rateLimitPrefix}${keyId}:h:${Math.floor(now / 3600000)}`;
        const dayKey = `${this.rateLimitPrefix}${keyId}:d:${Math.floor(now / 86400000)}`;

        const [m, h, d] = await Promise.all([
          redis.incr(minuteKey),
          redis.incr(hourKey),
          redis.incr(dayKey)
        ]);

        if (m === 1) await redis.expire(minuteKey, 60);
        if (h === 1) await redis.expire(hourKey, 3600);
        if (d === 1) await redis.expire(dayKey, 86400);

        if (m > limits.perMinute)
          return { allowed: false, limit: 'perMinute', retryAfter: 60 };
        if (h > limits.perHour)
          return { allowed: false, limit: 'perHour', retryAfter: 3600 };
        if (d > limits.perDay)
          return { allowed: false, limit: 'perDay', retryAfter: 86400 };

      } catch (err) {
        console.warn('Redis rate limit failed → fallback memory');
      }
    }

    // ⚠️ Memory fallback (NEW FIX)
    const fallbackKey = `${keyId}:${Math.floor(now / 60000)}`;
    const count = memoryCache.get(fallbackKey) || 0;

    if (count >= limits.perMinute) {
      return { allowed: false, limit: 'perMinute', retryAfter: 60 };
    }

    memoryCache.set(fallbackKey, count + 1);

    return { allowed: true };
  }

  // -------------------------------
  // 📊 LOGGING + BILLING
  // -------------------------------
  async logRequestAndGenerateBill(logData) {
    try {
      const log = new UsageLog(logData);
      await log.save();

      await ApiKey.findByIdAndUpdate(logData.apiKey, {
        lastUsedAt: new Date()
      });

      await this.updateBillingRecord(logData);
    } catch (error) {
      console.error('Logging error:', error);
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
          dueDate: amount > 0 ? new Date(Date.now() + 7 * 86400000) : null,
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
      console.error('Billing error:', error);
    }
  }

  // -------------------------------
  // 🔁 REQUEST FORWARDING
  // -------------------------------
  async forwardRequest(targetUrl, body, headers, method) {
    try {
      const response = await axios({
        method,
        url: targetUrl,
        data: body,
        headers: { ...headers, 'x-forwarded-by': 'MeterFlow-Gateway' },
        timeout: 30000
      });

      return response;
    } catch (error) {
      return error.response || { status: 500, data: { error: 'Gateway error' } };
    }
  }
}

// -------------------------------
// 🚪 MIDDLEWARES
// -------------------------------
const gatewayMiddleware = async (req, res, next) => {
  const gateway = new APIGateway();

  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'API key required' });

    const keyData = await gateway.validateApiKey(apiKey);
    if (!keyData)
      return res.status(401).json({ error: 'Invalid API key' });

    const rateLimit = await gateway.checkRateLimit(
      keyData.id,
      keyData.consumerId,
      keyData.rateLimit
    );

    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: `Rate limit exceeded (${rateLimit.limit})`,
        retryAfter: rateLimit.retryAfter
      });
    }

    req.gateway = { keyData, apiKey, startTime: Date.now() };
    next();
  } catch (err) {
    console.error('Gateway error:', err);
    res.status(500).json({ error: 'Gateway error' });
  }
};

const proxyMiddleware = async (req, res) => {
  const gateway = new APIGateway();
  const { keyData, apiKey, startTime } = req.gateway;

  const targetUrl = `${keyData.baseUrl}${req.originalUrl}`;

  const response = await gateway.forwardRequest(
    targetUrl,
    req.body,
    req.headers,
    req.method
  );

  const responseTime = Date.now() - startTime;
  const cost = keyData.pricing?.perRequestPrice || 0.001;

  await gateway.logRequestAndGenerateBill({
    apiKey,
    apiId: keyData.apiId,
    consumerId: keyData.consumerId,
    endpoint: req.originalUrl,
    method: req.method,
    statusCode: response.status,
    responseTime,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    cost
  });

  res.setHeader('X-Request-Cost', `$${cost}`);
  res.status(response.status).json(response.data);
};

module.exports = {
  gatewayMiddleware,
  proxyMiddleware,
  APIGateway
};