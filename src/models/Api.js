const mongoose = require('mongoose');

const apiSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  description: String,
  baseUrl: {
    type: String,
    required: true
  },
  endpoint: {
    type: String,
    default: '/'
  },
  method: {
    type: String,
    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    default: 'GET'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  rateLimit: {
    perMinute: { type: Number, default: 60 },
    perHour: { type: Number, default: 1000 },
    perDay: { type: Number, default: 10000 }
  },
  pricing: {
    freeTier: { type: Number, default: 1000 },
    perRequestPrice: { type: Number, default: 0.005 },
    currency: { type: String, default: 'USD' }
  },
  icon: String,
  category: String
}, { timestamps: true });

module.exports = mongoose.model('Api', apiSchema);