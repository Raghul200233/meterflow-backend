const QRCode = require('qrcode');
const crypto = require('crypto');
const Billing = require('../models/Billing');
const User = require('../models/User');

// Store payment sessions (in production, use Redis)
const paymentSessions = new Map();

// Create payment session and generate QR code
const createPaymentSession = async (req, res) => {
  try {
    const { invoiceId, amount, paymentMethod = 'upi' } = req.body;
    
    console.log(`Creating payment session for invoice: ${invoiceId}, Amount: $${amount}`);
    
    // Get invoice details
    const invoice = await Billing.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    // Check if already paid
    if (invoice.status === 'paid') {
      return res.status(400).json({ error: 'Invoice already paid' });
    }
    
    // Generate unique session ID
    const sessionId = 'pay_' + crypto.randomBytes(16).toString('hex');
    const upiId = 'meterflow@okhdfcbank'; // Your UPI ID
    
    // Calculate INR amount (assuming 1 USD = 83 INR)
    const inrAmount = (amount * 83).toFixed(2);
    
    // Generate UPI QR Code string
    const upiString = `upi://pay?pa=${upiId}&pn=MeterFlow&am=${inrAmount}&cu=INR&tn=Payment%20for%20API%20Usage%20-%20Invoice%20${invoice._id.toString().slice(-8)}`;
    
    // Generate QR code as base64
    const qrCodeBase64 = await QRCode.toDataURL(upiString, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 300,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    
    // Store session
    paymentSessions.set(sessionId, {
      sessionId,
      invoiceId,
      amount,
      upiId,
      upiString,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes expiry
    });
    
    console.log(`Payment session created: ${sessionId}`);
    
    res.json({
      success: true,
      sessionId,
      qrCode: qrCodeBase64,
      upiId: upiId,
      amount: amount,
      inrAmount: inrAmount,
      expiresIn: 900, // 15 minutes in seconds
      upiString: upiString
    });
    
  } catch (error) {
    console.error('Error creating payment session:', error);
    res.status(500).json({ error: error.message });
  }
};

// Check payment status
const checkPaymentStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = paymentSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Payment session not found' });
    }
    
    // In production, you would verify with actual payment gateway
    // For demo, we'll check if session is still valid
    const isExpired = new Date() > session.expiresAt;
    
    res.json({
      status: session.status,
      isExpired: isExpired,
      expiresAt: session.expiresAt
    });
    
  } catch (error) {
    console.error('Error checking payment status:', error);
    res.status(500).json({ error: error.message });
  }
};

// Verify payment (called after user completes payment)
const verifyPayment = async (req, res) => {
  try {
    const { sessionId, transactionId, upiReference } = req.body;
    
    console.log(`Verifying payment for session: ${sessionId}`);
    
    const session = paymentSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Payment session not found' });
    }
    
    if (session.status === 'completed') {
      return res.status(400).json({ error: 'Payment already completed' });
    }
    
    // Update invoice status
    const invoice = await Billing.findById(session.invoiceId);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    // Mark invoice as paid
    invoice.status = 'paid';
    invoice.paidAt = new Date();
    invoice.paymentId = transactionId || 'UPI_' + crypto.randomBytes(8).toString('hex');
    invoice.paymentMethod = 'upi';
    invoice.upiReference = upiReference;
    
    await invoice.save();
    
    // Update session
    session.status = 'completed';
    session.completedAt = new Date();
    session.transactionId = transactionId;
    paymentSessions.set(sessionId, session);
    
    // Generate receipt
    const receiptId = 'RCPT_' + crypto.randomBytes(8).toString('hex').toUpperCase();
    const user = await User.findById(invoice.consumerId);
    
    const receipt = {
      receiptId: receiptId,
      invoiceId: invoice._id,
      invoiceNumber: `INV-${invoice._id.toString().slice(-8).toUpperCase()}`,
      amount: invoice.amount,
      currency: invoice.currency,
      paidAt: invoice.paidAt,
      paymentMethod: 'UPI',
      transactionId: invoice.paymentId,
      upiReference: upiReference,
      customer: {
        name: user.name,
        email: user.email
      }
    };
    
    console.log(`Payment verified for invoice: ${session.invoiceId}`);
    
    res.json({
      success: true,
      message: 'Payment verified successfully',
      receipt: receipt
    });
    
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get payment session details
const getPaymentSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = paymentSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Payment session not found' });
    }
    
    res.json({
      sessionId: session.sessionId,
      amount: session.amount,
      upiId: session.upiId,
      upiString: session.upiString,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    });
    
  } catch (error) {
    console.error('Error getting payment session:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createPaymentSession,
  checkPaymentStatus,
  verifyPayment,
  getPaymentSession
};