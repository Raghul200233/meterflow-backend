# 🔧 MeterFlow Backend API

API for usage-based billing platform with JWT auth and automated billing.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secrets

# Start development server
npm run dev

# Run billing worker
npm run worker

# Seed database
npm run seed
🔐 Environment Variables
env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/meterflow
JWT_SECRET=your_secret_key
JWT_REFRESH_SECRET=your_refresh_secret
ENCRYPTION_KEY=32_char_key
FRONTEND_URL=http://localhost:3000

