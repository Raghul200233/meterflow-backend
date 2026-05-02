const mongoose = require('mongoose');

const usageLogSchema = new mongoose.Schema({
  apiKey: { type: String, required: true, index: true },
  apiId: { type: mongoose.Schema.Types.ObjectId, ref: 'Api', required: true },
  consumerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  endpoint: String,
  method: String,
  statusCode: Number,
  responseTime: Number,
  timestamp: { type: Date, default: Date.now, index: true },
  ipAddress: String,
  userAgent: String,
  cost: { type: Number, default: 0 }
});

usageLogSchema.index({ consumerId: 1, timestamp: -1 });
usageLogSchema.index({ apiId: 1, timestamp: -1 });

module.exports = mongoose.model('UsageLog', usageLogSchema);