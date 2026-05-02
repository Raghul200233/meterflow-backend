const Redis = require('ioredis');
const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const Api = require('../models/Api');
const UsageLog = require('../models/UsageLog');
const Billing = require('../models/Billing');
const moment = require('moment');

const redis = new Redis(process.env.REDIS_URL);

class APIGateway {
  constructor() {
    this.rateLimitPrefix = 'rate_limit:';
    this.keyCachePrefix = 'api_key:';
  }

  async validateApiKey(apiKey) {
    const cacheKey = `${this.keyCachePrefix}${apiKey}`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const keyDoc = await ApiKey.findOne({ key: apiKey, status: 'active' })
      .populate('apiId');
    
    if (!keyDoc) {
      return null;
    }

    if (keyDoc.expiresAt && keyDoc.expiresAt < new Date()) {
      return null;
    }

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

    await redis.setex(cacheKey, 300, JSON.stringify(keyData));
    return keyData;
  }

  async checkRateLimit(keyId, consumerId, limits) {
    const now = new Date();
    const minuteKey = `${this.rateLimitPrefix}${keyId}:minute:${Math.floor(now.getTime() / 60000)}`;
    const hourKey = `${this.rateLimitPrefix}${keyId}:hour:${Math.floor(now.getTime() / 3600000)}`;
    const dayKey = `${this.rateLimitPrefix}${keyId}:day:${Math.floor(now.getTime() / 86400000)}`;

    const [minuteCount, hourCount, dayCount] = await Promise.all([
      redis.incr(minuteKey),
      redis.incr(hourKey),
      redis.incr(dayKey)
    ]);

    if (minuteCount === 1) await redis.expire(minuteKey, 60);
    if (hourCount === 1) await redis.expire(hourKey, 3600);
    if (dayCount === 1) await redis.expire(dayKey, 86400);

    if (minuteCount > limits.perMinute) {
      return { allowed: false, limit: 'perMinute', retryAfter: 60 };
    }
    if (hourCount > limits.perHour) {
      return { allowed: false, limit: 'perHour', retryAfter: 3600 };
    }
    if (dayCount > limits.perDay) {
      return { allowed: false, limit: 'perDay', retryAfter: 86400 };
    }

    return { allowed: true };
  }

  async logRequestAndGenerateBill(logData) {
    try {
      // Save usage log
      const log = new UsageLog(logData);
      await log.save();
      
      // Update API key last used
      await ApiKey.findByIdAndUpdate(logData.apiKey, { lastUsedAt: new Date() });
      
      // Generate/Update billing record for this month
      await this.updateBillingRecord(logData);
      
      return true;
    } catch (error) {
      console.error('Error logging request:', error);
      return false;
    }
  }

  // Add this function to apiGateway.js (inside the APIGateway class)

async updateBillingRecord(logData) {
  try {
    const Billing = require('../models/Billing');
    const Api = require('../models/Api');
    const UsageLog = require('../models/UsageLog');
    const moment = require('moment');
    
    const periodStart = moment().startOf('month').toDate();
    const periodEnd = moment().endOf('month').toDate();
    
    const api = await Api.findById(logData.apiId);
    if (!api) return;
    
    const freeTier = api.pricing?.freeTier || 1000;
    const perRequestPrice = api.pricing?.perRequestPrice || 0.001;
    
    // Count total requests for this month
    const totalRequests = await UsageLog.countDocuments({
      consumerId: logData.consumerId,
      apiId: logData.apiId,
      timestamp: { $gte: periodStart, $lte: periodEnd }
    });
    
    const paidRequests = Math.max(0, totalRequests - freeTier);
    const amount = paidRequests * perRequestPrice;
    
    // Find or create billing record
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
        totalRequests: totalRequests,
        paidRequests: paidRequests,
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
    console.log(`💰 Bill updated: $${amount} (${paidRequests} paid of ${totalRequests} total)`);
    
    return billing;
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
        headers: {
          ...headers,
          'x-forwarded-by': 'MeterFlow-Gateway'
        },
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
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const keyData = await gateway.validateApiKey(apiKey);
    if (!keyData) {
      return res.status(401).json({ error: 'Invalid or inactive API key' });
    }

    const rateLimitCheck = await gateway.checkRateLimit(
      keyData.id,
      keyData.consumerId,
      keyData.rateLimit
    );

    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        error: `Rate limit exceeded (${rateLimitCheck.limit})`,
        retryAfter: rateLimitCheck.retryAfter
      });
    }

    req.gateway = {
      keyData,
      apiKey,
      startTime: Date.now()
    };

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
  const response = await gateway.forwardRequest(
    targetUrl,
    req.body,
    req.headers,
    req.method
  );
  
  const responseTime = Date.now() - startTime;
  
  // Calculate cost based on pricing
  let cost = keyData.pricing?.perRequestPrice || 0.001;
  
  // Log request and generate bill automatically
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
  
  // Add billing headers to response
  res.setHeader('X-Rate-Limit-Remaining', 'pending'); // Would need to track remaining
  res.setHeader('X-Request-Cost', `$${cost}`);
  
  res.status(response.status).json(response.data);
};

module.exports = { gatewayMiddleware, proxyMiddleware, APIGateway };