console.log('🚀 Starting MeterFlow Backend...');
const PORT = process.env.PORT || 6005;
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const Redis = require('ioredis');
require('dotenv').config();

// Import routes
const authRoutes = require('./src/routes/authRoutes');
const apiRoutes = require('./src/routes/apiRoutes');
const billingRoutes = require('./src/routes/billingRoutes');
const statsRoutes = require('./src/routes/statsRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const consumerRoutes = require('./src/routes/consumerRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');

// Import gateway middleware
const { gatewayMiddleware, proxyMiddleware } = require('./src/middleware/apiGateway');

const app = express();

// ==================== REDIS SETUP (with proper error handling) ====================
let redisClient = null;
let redisAvailable = false;

// Only attempt Redis if REDIS_URL is provided
if (process.env.REDIS_URL && process.env.REDIS_URL !== '') {
  console.log('🔄 Initializing Redis connection...');
  
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      lazyConnect: true, // Don't connect immediately
      retryStrategy: (times) => {
        if (times > 2) {
          console.warn('⚠️ Redis unavailable after multiple attempts, continuing without Redis.');
          redisAvailable = false;
          return null; // Stop retrying completely
        }
        return Math.min(times * 100, 1000);
      },
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis connected successfully');
      redisAvailable = true;
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis is ready');
    });

    redisClient.on('error', (err) => {
      // Only log once to avoid spam
      if (redisAvailable !== false) {
        console.warn('⚠️ Redis connection error:', err.message);
        console.warn('⚠️ Continuing without Redis (rate limiting disabled)');
      }
      redisAvailable = false;
    });

    redisClient.on('close', () => {
      if (redisAvailable) {
        console.warn('⚠️ Redis connection closed');
      }
      redisAvailable = false;
    });

    // Attempt connection
    redisClient.connect().catch(err => {
      console.warn('⚠️ Could not connect to Redis:', err.message);
      redisAvailable = false;
    });
    
  } catch (err) {
    console.warn('⚠️ Redis initialization failed:', err.message);
    redisAvailable = false;
  }
} else {
  console.log('ℹ️ No REDIS_URL provided, running without Redis (rate limiting disabled)');
}

// Make Redis client available globally
global.redisClient = redisClient;
global.redisAvailable = redisAvailable;

// ==================== EXPRESS MIDDLEWARE ====================

// Root route - API information
app.get('/', (req, res) => {
  res.json({
    name: 'MeterFlow API',
    version: '1.0.0',
    status: 'healthy',
    redis: redisAvailable ? 'connected' : 'disabled',
    endpoints: {
      health: '/health',
      api: '/api',
      gateway: '/gateway'
    }
  });
});

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL,
  'https://meterflow.vercel.app',
  'https://meterflow-git-main.vercel.app'
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked: ${origin}`);
      callback(null, true); // Allow anyway for now, but log it
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

app.use(helmet());
app.use(express.json());
app.use(morgan('combined'));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(), 
    uptime: process.uptime(),
    redis: redisAvailable ? 'connected' : 'disabled'
  });
});

// Gateway endpoints
app.use('/gateway/*', gatewayMiddleware, proxyMiddleware);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/apis', apiRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/consumer', consumerRoutes);
app.use('/api/payments', paymentRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ==================== MONGODB CONNECTION & SERVER START ====================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/meterflow';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ MongoDB connected successfully');
  app.listen(PORT, () => {
    console.log(`🚀 MeterFlow server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Redis status: ${redisAvailable ? '✅ connected' : '⚠️ disabled (rate limiting off)'}`);
    if (!redisAvailable) {
      console.log('💡 To enable rate limiting, set REDIS_URL environment variable (e.g., from Upstash)');
    }
  });
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

module.exports = { app, redisClient, redisAvailable };