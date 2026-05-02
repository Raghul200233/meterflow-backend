console.log('🚀 Starting MeterFlow Backend...');

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const Redis = require('ioredis');

// Import routes
const authRoutes = require('./src/routes/authRoutes');
const apiRoutes = require('./src/routes/apiRoutes');
const billingRoutes = require('./src/routes/billingRoutes');
const statsRoutes = require('./src/routes/statsRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const consumerRoutes = require('./src/routes/consumerRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');

// Gateway middleware
const { gatewayMiddleware, proxyMiddleware } = require('./src/middleware/apiGateway');

const app = express();

// ✅ FIX 1: Correct PORT
const PORT = process.env.PORT || 5000;

// ==================== REDIS SETUP ====================
global.redisClient = null;
global.redisAvailable = false;

const REDIS_URL = process.env.REDIS_URL; // ❗ remove localhost fallback

const initRedis = async () => {
  if (!REDIS_URL) {
    console.warn('⚠️ No REDIS_URL provided → using in-memory fallback');
    return;
  }

  try {
    const redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    redis.on('connect', () => {
      console.log('✅ Redis connected');
    });

    redis.on('ready', () => {
      console.log('✅ Redis ready');
      global.redisAvailable = true;
    });

    redis.on('error', (err) => {
      console.error('❌ Redis error:', err.message);
      global.redisAvailable = false;
    });

    redis.on('close', () => {
      console.warn('⚠️ Redis connection closed');
      global.redisAvailable = false;
    });

    // Test connection
    await redis.ping();

    global.redisClient = redis;
    global.redisAvailable = true;

    console.log('✅ Redis fully initialized');

  } catch (err) {
    console.warn('⚠️ Redis unavailable → fallback mode:', err.message);
    global.redisAvailable = false;
    global.redisClient = null;
  }
};

// Initialize Redis (non-blocking)
initRedis();

// ==================== MIDDLEWARE ====================
app.use(helmet());

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

app.use(express.json());
app.use(morgan('combined'));

// ==================== ROUTES ====================

// Root
app.get('/', (req, res) => {
  res.json({
    name: 'MeterFlow API',
    version: '1.0.0',
    status: 'healthy'
  });
});

// Health
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    uptime: process.uptime(),
    redis: global.redisAvailable ? 'connected' : 'fallback'
  });
});

// Gateway
app.use('/gateway/*', gatewayMiddleware, proxyMiddleware);

// APIs
app.use('/api/auth', authRoutes);
app.use('/api/apis', apiRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/consumer', consumerRoutes);
app.use('/api/payments', paymentRoutes);

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({ error: err.message });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ==================== MONGODB + SERVER ====================
mongoose.connect(
  process.env.MONGODB_URI || 'mongodb://localhost:27017/meterflow',
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
)
.then(() => {
  console.log('✅ MongoDB connected');

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Redis: ${global.redisAvailable ? '✅ connected' : '⚠️ fallback mode'}`);
  });
})
.catch(err => {
  console.error('❌ MongoDB connection failed:', err);
  process.exit(1);
});

module.exports = { app };