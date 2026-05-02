// backend/src/controllers/billingController.js
const Billing = require('../models/Billing');
const UsageLog = require('../models/UsageLog');
const Api = require('../models/Api');
const User = require('../models/User');
const { Queue } = require('bullmq');
const moment = require('moment');
const mongoose = require('mongoose');
const crypto = require('crypto');

const billingQueue = new Queue('billing', { 
  connection: { host: 'localhost', port: 6379 } 
});

// Get current usage for consumer
const getCurrentUsage = async (req, res) => {
  try {
    const consumerId = req.params.consumerId || req.userId;
    const periodStart = moment().startOf('month').toDate();
    const periodEnd = moment().endOf('month').toDate();
    
    const usage = await UsageLog.aggregate([
      {
        $match: {
          consumerId: new mongoose.Types.ObjectId(consumerId),
          timestamp: { $gte: periodStart, $lte: periodEnd }
        }
      },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalCost: { $sum: '$cost' }
        }
      }
    ]);
    
    // Get per-API breakdown
    const perApiUsage = await UsageLog.aggregate([
      {
        $match: {
          consumerId: new mongoose.Types.ObjectId(consumerId),
          timestamp: { $gte: periodStart, $lte: periodEnd }
        }
      },
      {
        $group: {
          _id: '$apiId',
          requests: { $sum: 1 },
          cost: { $sum: '$cost' }
        }
      },
      {
        $lookup: {
          from: 'apis',
          localField: '_id',
          foreignField: '_id',
          as: 'api'
        }
      },
      { $unwind: '$api' }
    ]);
    
    res.json({
      period: { start: periodStart, end: periodEnd },
      totalRequests: usage[0]?.totalRequests || 0,
      totalCost: usage[0]?.totalCost || 0,
      perApi: perApiUsage
    });
  } catch (error) {
    console.error('Error getting usage:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get all invoices for a user
const getInvoices = async (req, res) => {
  try {
    const invoices = await Billing.find({ consumerId: req.userId })
      .sort({ createdAt: -1 })
      .populate('apiId', 'name description icon');
    
    console.log(`Found ${invoices.length} invoices for user ${req.userId}`);
    res.json(invoices);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get single invoice by ID
const getInvoice = async (req, res) => {
  try {
    const invoice = await Billing.findOne({ 
      _id: req.params.id, 
      consumerId: req.userId 
    }).populate('apiId', 'name description').populate('consumerId', 'name email');
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    // Get usage breakdown for this invoice
    const usageBreakdown = await UsageLog.aggregate([
      {
        $match: {
          consumerId: invoice.consumerId,
          timestamp: { $gte: invoice.period.start, $lte: invoice.period.end }
        }
      },
      {
        $group: {
          _id: '$apiId',
          count: { $sum: 1 },
          cost: { $sum: '$cost' }
        }
      },
      {
        $lookup: {
          from: 'apis',
          localField: '_id',
          foreignField: '_id',
          as: 'api'
        }
      },
      { $unwind: '$api' }
    ]);
    
    res.json({
      invoice,
      usageBreakdown
    });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: error.message });
  }
};

// Pay invoice
const payInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod = 'card' } = req.body;
    
    console.log(`Processing payment for invoice: ${id}`);
    console.log(`Payment method: ${paymentMethod}`);
    
    // Find invoice
    const invoice = await Billing.findById(id);
    
    if (!invoice) {
      console.log('Invoice not found:', id);
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    console.log(`Invoice found - Amount: $${invoice.amount}, Status: ${invoice.status}`);
    
    // Check if already paid
    if (invoice.status === 'paid') {
      console.log('Invoice already paid');
      return res.status(400).json({ error: 'Invoice already paid' });
    }
    
    // Check if invoice belongs to the user
    if (invoice.consumerId.toString() !== req.userId.toString()) {
      console.log('Unauthorized - Invoice belongs to different user');
      return res.status(403).json({ error: 'Unauthorized to pay this invoice' });
    }
    
    // Generate unique payment ID
    const paymentId = 'pay_' + crypto.randomBytes(16).toString('hex');
    const receiptId = 'RCPT_' + crypto.randomBytes(8).toString('hex').toUpperCase();
    
    // Update invoice
    invoice.status = 'paid';
    invoice.paidAt = new Date();
    invoice.paymentId = paymentId;
    
    await invoice.save();
    
    console.log(`Payment successful! Payment ID: ${paymentId}`);
    
    // Generate receipt
    const receipt = {
      receiptId: receiptId,
      invoiceId: invoice._id,
      invoiceNumber: `INV-${invoice._id.toString().slice(-8).toUpperCase()}`,
      amount: invoice.amount,
      currency: invoice.currency || 'USD',
      paidAt: invoice.paidAt,
      paymentMethod: paymentMethod,
      paymentId: paymentId,
      customer: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email
      },
      period: {
        start: invoice.period.start,
        end: invoice.period.end
      }
    };
    
    res.json({
      success: true,
      message: 'Payment successful',
      paymentId: paymentId,
      receiptId: receiptId,
      invoice: invoice,
      receipt: receipt
    });
    
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Mark invoice as paid manually (admin only)
const markInvoicePaid = async (req, res) => {
  try {
    const invoice = await Billing.findOneAndUpdate(
      { _id: req.params.id },
      { 
        status: 'paid',
        paidAt: new Date(),
        paymentId: req.body.paymentId || 'manual_' + crypto.randomBytes(16).toString('hex')
      },
      { new: true }
    );
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    res.json({
      success: true,
      message: 'Invoice marked as paid',
      invoice
    });
  } catch (error) {
    console.error('Error marking invoice as paid:', error);
    res.status(500).json({ error: error.message });
  }
};

// Trigger billing cycle (admin only)
const triggerBillingCycle = async (req, res) => {
  try {
    const periodStart = req.body.periodStart || moment().subtract(1, 'month').startOf('month').toDate();
    const periodEnd = req.body.periodEnd || moment().subtract(1, 'month').endOf('month').toDate();
    
    console.log(`Triggering billing cycle from ${periodStart} to ${periodEnd}`);
    
    // Get all consumers with usage
    const consumers = await UsageLog.distinct('consumerId', {
      timestamp: { $gte: periodStart, $lte: periodEnd }
    });
    
    console.log(`Found ${consumers.length} consumers with usage`);
    
    // Add jobs to queue for each consumer
    const jobs = [];
    for (const consumerId of consumers) {
      jobs.push(
        billingQueue.add('consumer-billing', {
          consumerId: consumerId.toString(),
          periodStart,
          periodEnd
        })
      );
    }
    
    await Promise.all(jobs);
    
    res.json({ 
      success: true,
      message: `Billing cycle triggered for ${consumers.length} consumers`,
      jobs: jobs.length
    });
  } catch (error) {
    console.error('Error triggering billing cycle:', error);
    res.status(500).json({ error: error.message });
  }
};

// Generate demo invoice (for testing)
const generateDemoInvoice = async (req, res) => {
  try {
    const { consumerEmail, amount = 25.50, requests = 150 } = req.body;
    
    // Find consumer
    const consumer = await User.findOne({ email: consumerEmail, role: 'consumer' });
    if (!consumer) {
      return res.status(404).json({ error: 'Consumer not found' });
    }
    
    // Check if invoice already exists for this period
    const periodStart = moment().startOf('month').toDate();
    const periodEnd = moment().endOf('month').toDate();
    
    const existingInvoice = await Billing.findOne({
      consumerId: consumer._id,
      'period.start': periodStart,
      'period.end': periodEnd
    });
    
    if (existingInvoice) {
      return res.status(400).json({ error: 'Invoice already exists for this period' });
    }
    
    // Create new invoice
    const invoice = new Billing({
      consumerId: consumer._id,
      period: { start: periodStart, end: periodEnd },
      totalRequests: requests,
      paidRequests: Math.max(0, requests - 1000),
      amount: amount,
      currency: 'USD',
      status: 'pending',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
    
    await invoice.save();
    
    res.status(201).json({
      success: true,
      message: 'Demo invoice created',
      invoice
    });
  } catch (error) {
    console.error('Error generating demo invoice:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get payment summary for dashboard
const getPaymentSummary = async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.user.role;
    
    let matchCondition = {};
    
    if (userRole === 'admin') {
      // Admin sees all invoices
      matchCondition = {};
    } else if (userRole === 'api_owner') {
      // API owner sees invoices for their APIs
      const userApis = await Api.find({ userId });
      const apiIds = userApis.map(api => api._id);
      matchCondition = { apiId: { $in: apiIds } };
    } else {
      // Consumer sees their own invoices
      matchCondition = { consumerId: userId };
    }
    
    const summary = await Billing.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: '$status',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);
    
    const totalBilled = summary.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalPaid = summary.find(s => s._id === 'paid')?.totalAmount || 0;
    const totalPending = summary.find(s => s._id === 'pending')?.totalAmount || 0;
    
    res.json({
      totalBilled,
      totalPaid,
      totalPending,
      paidCount: summary.find(s => s._id === 'paid')?.count || 0,
      pendingCount: summary.find(s => s._id === 'pending')?.count || 0,
      summary
    });
  } catch (error) {
    console.error('Error getting payment summary:', error);
    res.status(500).json({ error: error.message });
  }
};

// Download invoice as PDF (simplified - returns JSON receipt)
const downloadInvoice = async (req, res) => {
  try {
    const invoice = await Billing.findById(req.params.id)
      .populate('consumerId', 'name email')
      .populate('apiId', 'name');
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    const receipt = {
      invoiceNumber: `INV-${invoice._id.toString().slice(-8).toUpperCase()}`,
      date: invoice.createdAt,
      dueDate: invoice.dueDate,
      customer: {
        name: invoice.consumerId.name,
        email: invoice.consumerId.email
      },
      items: [
        {
          description: invoice.apiId ? `API Usage - ${invoice.apiId.name}` : 'API Usage Charges',
          period: `${new Date(invoice.period.start).toLocaleDateString()} - ${new Date(invoice.period.end).toLocaleDateString()}`,
          requests: invoice.totalRequests,
          paidRequests: invoice.paidRequests,
          amount: invoice.amount
        }
      ],
      subtotal: invoice.amount,
      total: invoice.amount,
      currency: invoice.currency,
      status: invoice.status,
      paymentId: invoice.paymentId,
      paidAt: invoice.paidAt
    };
    
    res.json(receipt);
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({ error: error.message });
  }
};

const getCurrentBill = async (req, res) => {
  try {
    const consumerId = req.userId;
    const periodStart = moment().startOf('month').toDate();
    const periodEnd = moment().endOf('month').toDate();
    
    const bills = await Billing.find({
      consumerId,
      'period.start': periodStart,
      'period.end': periodEnd
    }).populate('apiId', 'name icon');
    
    const totalRequests = bills.reduce((sum, b) => sum + (b.totalRequests || 0), 0);
    const totalAmount = bills.reduce((sum, b) => sum + (b.amount || 0), 0);
    const paidAmount = bills.filter(b => b.status === 'paid').reduce((sum, b) => sum + (b.amount || 0), 0);
    const pendingAmount = totalAmount - paidAmount;
    
    res.json({
      period: { start: periodStart, end: periodEnd },
      totalRequests,
      totalAmount,
      paidAmount,
      pendingAmount,
      bills
    });
  } catch (error) {
    console.error('Error getting current bill:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { 
  getCurrentUsage, 
  getInvoices, 
  getInvoice, 
  payInvoice,
  markInvoicePaid,
  triggerBillingCycle,
  generateDemoInvoice,
  getPaymentSummary,
  downloadInvoice,
  getCurrentBill
};