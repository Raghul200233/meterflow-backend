const mongoose = require('mongoose');

const apiKeySchema = new mongoose.Schema({
  apiId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Api',
    required: true
  },
  consumerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  key: {
    type: String,
    required: true,
    unique: true
  },
  keyPrefix: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'revoked', 'expired'],
    default: 'active'
  },
  rateLimit: {
    perMinute: Number,
    perHour: Number,
    perDay: Number
  },
  lastUsedAt: Date,
  expiresAt: Date
}, { timestamps: true });

apiKeySchema.index({ key: 1 });
apiKeySchema.index({ apiId: 1, consumerId: 1 });

module.exports = mongoose.model('ApiKey', apiKeySchema);