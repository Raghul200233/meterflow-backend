// backend/src/controllers/consumerController.js
const Api = require('../models/Api');
const ApiKey = require('../models/ApiKey');
const Billing = require('../models/Billing');
const crypto = require('crypto');
const moment = require('moment');

const generateApiKey = () => {
  return 'mf_' + crypto.randomBytes(32).toString('hex');
};

// Get all available APIs for consumers
const getAvailableApis = async (req, res) => {
  try {
    const apis = await Api.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(apis || []);
  } catch (error) {
    console.error('Error fetching available APIs:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get consumer's API keys
const getMyApiKeys = async (req, res) => {
  try {
    const keys = await ApiKey.find({ 
      consumerId: req.userId, 
      status: 'active' 
    }).populate('apiId');
    
    res.json(keys || []);
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get consumer usage stats
const getConsumerUsage = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const UsageLog = require('../models/UsageLog');
    const usage = await UsageLog.aggregate([
      {
        $match: {
          consumerId: req.userId,
          timestamp: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalCost: { $sum: '$cost' }
        }
      }
    ]);
    
    res.json({
      totalRequests: usage[0]?.totalRequests || 0,
      totalCost: usage[0]?.totalCost || 0
    });
  } catch (error) {
    console.error('Error fetching usage:', error);
    res.json({ totalRequests: 0, totalCost: 0 });
  }
};

// Initialize/Create billing record for a consumer and API
const initializeBillingRecord = async (consumerId, apiId) => {
  try {
    const periodStart = moment().startOf('month').toDate();
    const periodEnd = moment().endOf('month').toDate();
    
    // Check if billing record already exists
    const existingBill = await Billing.findOne({
      consumerId,
      apiId,
      'period.start': periodStart,
      'period.end': periodEnd
    });
    
    if (!existingBill) {
      const api = await Api.findById(apiId);
      if (!api) return null;
      
      // Create initial billing record with zero usage
      const billing = new Billing({
        consumerId,
        apiId,
        period: { start: periodStart, end: periodEnd },
        totalRequests: 0,
        paidRequests: 0,
        amount: 0,
        currency: api.pricing?.currency || 'USD',
        status: 'pending',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });
      
      await billing.save();
      console.log(`✅ Initial billing record created for API: ${api.name}`);
      return billing;
    }
    
    return existingBill;
  } catch (error) {
    console.error('Error initializing billing record:', error);
    return null;
  }
};

// Request access to an API (Generate API Key)
const requestAccess = async (req, res) => {
  try {
    const { apiId } = req.body;
    
    const api = await Api.findById(apiId);
    if (!api) {
      return res.status(404).json({ error: 'API not found' });
    }
    
    // Check if already has key
    const existingKey = await ApiKey.findOne({
      apiId,
      consumerId: req.userId,
      status: 'active'
    });
    
    if (existingKey) {
      return res.status(400).json({ error: 'You already have an API key for this API' });
    }
    
    // Generate new API key
    const newKey = generateApiKey();
    const keyPrefix = newKey.substring(0, 10);
    
    const apiKey = new ApiKey({
      apiId,
      consumerId: req.userId,
      key: newKey,
      keyPrefix: keyPrefix,
      status: 'active',
      rateLimit: api.rateLimit
    });
    
    await apiKey.save();
    
    // 🆕 INITIALIZE BILLING RECORD FOR THIS API
    await initializeBillingRecord(req.userId, apiId);
    
    console.log(`🔑 API Key generated for ${api.name}`);
    console.log(`💰 Billing record initialized for consumer`);
    
    res.status(201).json({ 
      message: 'API key generated successfully',
      apiKey: newKey,
      keyPrefix: keyPrefix
    });
  } catch (error) {
    console.error('Error requesting access:', error);
    res.status(500).json({ error: error.message });
  }
};

// Revoke API key
const revokeKey = async (req, res) => {
  try {
    const { keyId } = req.params;
    
    const apiKey = await ApiKey.findOne({
      _id: keyId,
      consumerId: req.userId
    });
    
    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }
    
    apiKey.status = 'revoked';
    await apiKey.save();
    
    res.json({ message: 'API key revoked successfully' });
  } catch (error) {
    console.error('Error revoking key:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { 
  getAvailableApis, 
  getMyApiKeys, 
  requestAccess,
  getConsumerUsage,
  revokeKey
};