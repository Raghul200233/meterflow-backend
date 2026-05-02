const mongoose = require('mongoose');

const billingSchema = new mongoose.Schema({
  consumerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  apiId: { type: mongoose.Schema.Types.ObjectId, ref: 'Api' },
  period: { start: Date, end: Date },
  totalRequests: { type: Number, default: 0 },
  paidRequests: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' },
  status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  paymentId: String,
  receiptUrl: String,
  dueDate: Date,
  paidAt: Date
}, { timestamps: true });

module.exports = mongoose.model('Billing', billingSchema);