const express = require('express');
const { 
  getAvailableApis, 
  getMyApiKeys, 
  requestAccess,
  getConsumerUsage,
    revokeKey 
} = require('../controllers/consumerController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

// Apply authentication and role checking
router.use(authMiddleware);
router.use(roleMiddleware('consumer'));

// Routes
router.get('/available-apis', getAvailableApis);
router.get('/my-keys', getMyApiKeys);
router.get('/usage', getConsumerUsage);
router.post('/request-access', requestAccess);
router.delete('/revoke-key/:keyId', revokeKey);

module.exports = router;