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

// ==================== REDIS CONNECTION (with fallback) ====================
let redisClient = null;
let redisAvailable = false;

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const initRedis = async () => {
  try {
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: true,               // Don't connect on instantiation
      retryStrategy: (times) => {
        if (times > 5) {
          console.error(`❌ Redis connection failed after ${times} attempts. Continuing without Redis.`);
          redisAvailable = false;
          return null; // Stop retrying
        }
        const delay = Math.min(times * 100, 3000);
        console.log(`🔄 Redis reconnecting in ${delay}ms (attempt ${times}/5)`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableAutoPipelining: true,
      showFriendlyErrorStack: process.env.NODE_ENV !== 'production',
    });

    // Event handlers
    redisClient.on('connect', () => {
      console.log('✅ Redis connection established');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis client ready and authenticated');
      redisAvailable = true;
    });

    redisClient.on('error', (err) => {
      if (redisAvailable) {
        console.error('❌ Redis runtime error:', err.message);
      }
      redisAvailable = false;
    });

    redisClient.on('close', () => {
      if (redisAvailable) console.warn('⚠️ Redis connection closed');
      redisAvailable = false;
    });

    redisClient.on('reconnecting', () => {
      console.log('🔄 Redis reconnecting...');
    });

    // Attempt connection
    await redisClient.connect();
    // Verify with ping
    const pong = await redisClient.ping();
    if (pong === 'PONG') {
      console.log('✅ Redis ping successful');
      redisAvailable = true;
    } else {
      throw new Error('Unexpected redis ping response');
    }
  } catch (err) {
    console.warn('⚠️ Redis not available, using in-memory fallback. Error:', err.message);
    redisAvailable = false;
    redisClient = null;
  }
};

// Make Redis client available globally for other modules (e.g., apiGateway)
global.redisClient = redisClient;
global.redisAvailable = redisAvailable;

// Call Redis init (non‑blocking)
initRedis();

// ==================== EXPRESS MIDDLEWARE & ROUTES ====================

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'MeterFlow API',
    version: '1.0.0',
    status: 'healthy',
    endpoints: {
      health: '/health',
      api: '/api',
      gateway: '/gateway'
    }
  });
});

// Security & utility middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));
app.use(express.json());
app.use(morgan('combined'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date(), uptime: process.uptime() });
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
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/meterflow', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ MongoDB connected successfully');
  app.listen(PORT, () => {
    console.log(`🚀 MeterFlow server running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Redis status: ${redisAvailable ? '✅ connected' : '⚠️ fallback mode (in‑memory)'}`);
  });
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

// Export for testing
module.exports = { app, redisClient, redisAvailable };