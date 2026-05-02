// backend/src/routes/billingRoutes.js
const express = require('express');
const {
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
} = require('../controllers/billingController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Consumer routes
router.get('/usage/:consumerId?', getCurrentUsage);
router.get('/invoices', getInvoices);
router.get('/invoices/:id', getInvoice);
router.post('/invoices/:id/pay', payInvoice);
router.get('/invoices/:id/download', downloadInvoice);
router.get('/summary', getPaymentSummary);
router.get('/current-bill', getCurrentBill);

// Admin only routes
router.post('/trigger', roleMiddleware('admin'), triggerBillingCycle);
router.post('/invoices/:id/mark-paid', roleMiddleware('admin'), markInvoicePaid);
router.post('/demo-invoice', roleMiddleware('admin'), generateDemoInvoice);

module.exports = router;