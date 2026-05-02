const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const UsageLog = require('../models/UsageLog');
const Billing = require('../models/Billing');
const Api = require('../models/Api');
require('dotenv').config();

const connection = { host: 'localhost', port: 6379 };

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Billing Worker: MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const billingWorker = new Worker('billing', async job => {
  const { consumerId, periodStart, periodEnd } = job.data;
  
  console.log(`Processing billing for consumer ${consumerId}`);
  console.log(`Period: ${periodStart} to ${periodEnd}`);
  
  try {
    // Aggregate usage per API
    const usageData = await UsageLog.aggregate([
      {
        $match: {
          consumerId: mongoose.Types.ObjectId(consumerId),
          timestamp: { $gte: new Date(periodStart), $lte: new Date(periodEnd) }
        }
      },
      {
        $group: {
          _id: '$apiId',
          totalRequests: { $sum: 1 },
          totalCost: { $sum: '$cost' }
        }
      }
    ]);
    
    const billingRecords = [];
    
    for (const usage of usageData) {
      const api = await Api.findById(usage._id);
      if (!api) {
        console.log(`API not found for ID: ${usage._id}`);
        continue;
      }
      
      const freeTier = api.pricing?.freeTier || 1000;
      const paidRequests = Math.max(0, usage.totalRequests - freeTier);
      const amount = paidRequests * (api.pricing?.perRequestPrice || 0.005);
      
      // Check for existing billing record
      let billing = await Billing.findOne({
        consumerId: mongoose.Types.ObjectId(consumerId),
        apiId: usage._id,
        'period.start': new Date(periodStart),
        'period.end': new Date(periodEnd)
      });
      
      if (!billing) {
        billing = new Billing({
          consumerId: mongoose.Types.ObjectId(consumerId),
          apiId: usage._id,
          period: { start: new Date(periodStart), end: new Date(periodEnd) },
          totalRequests: usage.totalRequests,
          paidRequests,
          amount: parseFloat(amount.toFixed(2)),
          currency: api.pricing?.currency || 'USD',
          status: amount > 0 ? 'pending' : 'paid',
          dueDate: amount > 0 ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
          paidAt: amount === 0 ? new Date() : null
        });
      } else {
        billing.totalRequests = usage.totalRequests;
        billing.paidRequests = paidRequests;
        billing.amount = parseFloat(amount.toFixed(2));
        billing.status = amount > 0 ? 'pending' : 'paid';
        if (amount === 0) billing.paidAt = new Date();
      }
      
      await billing.save();
      billingRecords.push(billing);
      
      console.log(`Billing record created for API ${api.name}: $${amount} (${paidRequests} paid requests)`);
    }
    
    return { 
      processed: usageData.length,
      totalAmount: billingRecords.reduce((sum, b) => sum + b.amount, 0),
      records: billingRecords 
    };
  } catch (error) {
    console.error(`Error processing billing for ${consumerId}:`, error);
    throw error;
  }
}, { connection });

billingWorker.on('completed', job => {
  console.log(`✅ Billing job ${job.id} completed for consumer ${job.data.consumerId}`);
  console.log('Result:', job.returnvalue);
});

billingWorker.on('failed', (job, err) => {
  console.error(`❌ Billing job ${job.id} failed:`, err);
});

billingWorker.on('error', err => {
  console.error('Worker error:', err);
});

module.exports = billingWorker;