const express = require('express');
const {
  createApi,
  getApis,
  getApi,
  updateApi,
  deleteApi,
  generateApiKeyForApi,
  getApiKeys,
  revokeApiKey,
  rotateApiKey
} = require('../controllers/apiController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// API Management routes (all require authentication)
router.post('/', roleMiddleware('admin', 'api_owner'), createApi);
router.get('/', roleMiddleware('admin', 'api_owner'), getApis);
router.get('/:id', roleMiddleware('admin', 'api_owner'), getApi);
router.put('/:id', roleMiddleware('admin', 'api_owner'), updateApi);
router.delete('/:id', roleMiddleware('admin', 'api_owner'), deleteApi);

// API Key Management routes
router.post('/:id/keys', roleMiddleware('admin', 'api_owner'), generateApiKeyForApi);
router.get('/:id/keys', roleMiddleware('admin', 'api_owner'), getApiKeys);
router.delete('/keys/:keyId', roleMiddleware('admin', 'api_owner'), revokeApiKey);
router.post('/keys/:keyId/rotate', roleMiddleware('admin', 'api_owner'), rotateApiKey);

module.exports = router;