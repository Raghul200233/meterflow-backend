const Api = require('../models/Api');
const ApiKey = require('../models/ApiKey');
const crypto = require('crypto');
const mongoose = require('mongoose');

// Generate unique API key
const generateApiKey = () => {
  const prefix = 'mf_';
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return prefix + randomBytes;
};

// Create new API
const createApi = async (req, res) => {
  try {
    console.log('📝 Creating API for user:', req.userId);
    console.log('📦 Received data:', JSON.stringify(req.body, null, 2));
    
    const { name, description, baseUrl, endpoint, method, rateLimit, pricing } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'API name is required' });
    }
    if (!baseUrl) {
      return res.status(400).json({ error: 'Base URL is required' });
    }
    
    // Create API object
    const apiData = {
      userId: req.userId,
      name: name.trim(),
      description: description || '',
      baseUrl: baseUrl.trim(),
      endpoint: endpoint || '/',
      method: method || 'GET',
      isActive: true,
      rateLimit: {
        perMinute: rateLimit?.perMinute || 60,
        perHour: rateLimit?.perHour || 1000,
        perDay: rateLimit?.perDay || 10000
      },
      pricing: {
        freeTier: pricing?.freeTier || 1000,
        perRequestPrice: pricing?.perRequestPrice || 0.005,
        currency: pricing?.currency || 'USD'
      }
    };
    
    console.log('📝 Creating API with data:', apiData);
    
    const api = new Api(apiData);
    await api.save();
    
    console.log('✅ API created successfully:', api._id);
    
    res.status(201).json({
      success: true,
      data: api,
      message: 'API created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating API:', error);
    console.error('Error stack:', error.stack);
    
    // Send detailed error response
    res.status(500).json({ 
      error: error.message,
      details: error.stack,
      message: 'Failed to create API'
    });
  }
};

// Get all APIs for a user
const getApis = async (req, res) => {
  try {
    console.log('📋 Fetching APIs for user:', req.userId);
    
    const apis = await Api.find({ userId: req.userId }).sort({ createdAt: -1 });
    
    console.log(`✅ Found ${apis.length} APIs`);
    
    res.json({
      success: true,
      data: apis
    });
  } catch (error) {
    console.error('❌ Error fetching APIs:', error);
    res.status(500).json({ 
      error: error.message,
      message: 'Failed to fetch APIs'
    });
  }
};

// Get single API
const getApi = async (req, res) => {
  try {
    const api = await Api.findOne({ _id: req.params.id, userId: req.userId });
    if (!api) {
      return res.status(404).json({ error: 'API not found' });
    }
    res.json({
      success: true,
      data: api
    });
  } catch (error) {
    console.error('Error fetching API:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update API
const updateApi = async (req, res) => {
  try {
    const updates = req.body;
    const api = await Api.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      updates,
      { new: true, runValidators: true }
    );
    
    if (!api) {
      return res.status(404).json({ error: 'API not found' });
    }
    
    res.json({
      success: true,
      data: api
    });
  } catch (error) {
    console.error('Error updating API:', error);
    res.status(500).json({ error: error.message });
  }
};

// Delete API
const deleteApi = async (req, res) => {
  try {
    const api = await Api.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!api) {
      return res.status(404).json({ error: 'API not found' });
    }
    
    // Also delete all associated API keys
    await ApiKey.deleteMany({ apiId: req.params.id });
    
    res.json({
      success: true,
      message: 'API deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting API:', error);
    res.status(500).json({ error: error.message });
  }
};

// Generate API key for an API
const generateApiKeyForApi = async (req, res) => {
  try {
    const { id } = req.params;
    const { consumerId, customRateLimit, expiresInDays } = req.body;
    
    const api = await Api.findOne({ _id: id, userId: req.userId });
    if (!api) {
      return res.status(404).json({ error: 'API not found' });
    }
    
    const fullKey = generateApiKey();
    const keyPrefix = fullKey.substring(0, 10);
    
    const apiKey = new ApiKey({
      apiId: id,
      consumerId: consumerId || req.userId,
      key: fullKey,
      keyPrefix: keyPrefix,
      rateLimit: customRateLimit || api.rateLimit,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null
    });
    
    await apiKey.save();
    
    res.status(201).json({
      success: true,
      data: {
        id: apiKey._id,
        key: fullKey,
        keyPrefix: keyPrefix,
        status: apiKey.status,
        expiresAt: apiKey.expiresAt
      }
    });
  } catch (error) {
    console.error('Error generating API key:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get all API keys for an API
const getApiKeys = async (req, res) => {
  try {
    const keys = await ApiKey.find({ apiId: req.params.id })
      .populate('consumerId', 'name email')
      .sort({ createdAt: -1 });
    
    // Don't send full keys for security
    const sanitizedKeys = keys.map(key => ({
      _id: key._id,
      keyPrefix: key.keyPrefix,
      key: key.key, // Include full key for display
      status: key.status,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      consumer: key.consumerId
    }));
    
    res.json({
      success: true,
      data: sanitizedKeys
    });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: error.message });
  }
};

// Revoke API key
const revokeApiKey = async (req, res) => {
  try {
    const apiKey = await ApiKey.findById(req.params.keyId);
    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }
    
    apiKey.status = 'revoked';
    await apiKey.save();
    
    // Clear from Redis cache
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL);
    await redis.del(`api_key:${apiKey.key}`);
    
    res.json({
      success: true,
      message: 'API key revoked successfully'
    });
  } catch (error) {
    console.error('Error revoking API key:', error);
    res.status(500).json({ error: error.message });
  }
};

// Rotate API key
const rotateApiKey = async (req, res) => {
  try {
    const oldKey = await ApiKey.findById(req.params.keyId);
    if (!oldKey) {
      return res.status(404).json({ error: 'API key not found' });
    }
    
    // Generate new key
    const newFullKey = generateApiKey();
    const newKeyPrefix = newFullKey.substring(0, 10);
    
    // Create new key
    const newKey = new ApiKey({
      apiId: oldKey.apiId,
      consumerId: oldKey.consumerId,
      key: newFullKey,
      keyPrefix: newKeyPrefix,
      rateLimit: oldKey.rateLimit,
      status: 'active'
    });
    
    await newKey.save();
    
    // Revoke old key
    oldKey.status = 'revoked';
    await oldKey.save();
    
    res.json({
      success: true,
      data: {
        newKey: newFullKey,
        newKeyPrefix: newKeyPrefix,
        message: 'Key rotated successfully. Old key has been revoked.'
      }
    });
  } catch (error) {
    console.error('Error rotating API key:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createApi,
  getApis,
  getApi,
  updateApi,
  deleteApi,
  generateApiKeyForApi,
  getApiKeys,
  revokeApiKey,
  rotateApiKey
};