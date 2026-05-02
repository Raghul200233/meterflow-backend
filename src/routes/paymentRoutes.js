const express = require('express');
const {
  createPaymentSession,
  checkPaymentStatus,
  verifyPayment,
  getPaymentSession
} = require('../controllers/paymentController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Protected routes
router.use(authMiddleware);

router.post('/create-session', createPaymentSession);
router.get('/session/:sessionId', getPaymentSession);
router.get('/status/:sessionId', checkPaymentStatus);
router.post('/verify', verifyPayment);

module.exports = router;