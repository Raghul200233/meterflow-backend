const express = require('express');
const { getDashboardStats, getDailyUsage, getTopApis } = require('../controllers/statsController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', authMiddleware, getDashboardStats);
router.get('/usage/daily', authMiddleware, getDailyUsage);
router.get('/apis/top', authMiddleware, getTopApis);

module.exports = router;