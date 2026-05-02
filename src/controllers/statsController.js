const UsageLog = require('../models/UsageLog');
const ApiKey = require('../models/ApiKey');
const Billing = require('../models/Billing');
const mongoose = require('mongoose');
const moment = require('moment');

const getDashboardStats = async (req, res) => {
  try {
    const userId = req.userId;
    const startOfMonth = moment().startOf('month').toDate();
    const endOfMonth = moment().endOf('month').toDate();
    
    // Get API keys owned by user's APIs
    const userApis = await require('../models/Api').find({ userId });
    const apiIds = userApis.map(api => api._id);
    
    const apiKeys = await ApiKey.find({ apiId: { $in: apiIds } });
    const activeKeys = apiKeys.filter(key => key.status === 'active').length;
    
    // Get usage stats
    const usageStats = await UsageLog.aggregate([
      {
        $match: {
          apiId: { $in: apiIds },
          timestamp: { $gte: startOfMonth, $lte: endOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalErrors: {
            $sum: {
              $cond: [{ $gte: ['$statusCode', 400] }, 1, 0]
            }
          },
          totalCost: { $sum: '$cost' }
        }
      }
    ]);
    
    const stats = usageStats[0] || { totalRequests: 0, totalErrors: 0, totalCost: 0 };
    const errorRate = stats.totalRequests > 0 ? stats.totalErrors / stats.totalRequests : 0;
    
    res.json({
      totalRequests: stats.totalRequests,
      activeKeys: activeKeys,
      totalRevenue: stats.totalCost,
      errorRate: errorRate
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDailyUsage = async (req, res) => {
  try {
    const userId = req.userId;
    const days = parseInt(req.query.days) || 30;
    const startDate = moment().subtract(days, 'days').startOf('day').toDate();
    
    const userApis = await require('../models/Api').find({ userId });
    const apiIds = userApis.map(api => api._id);
    
    const usage = await UsageLog.aggregate([
      {
        $match: {
          apiId: { $in: apiIds },
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            isError: { $gte: ['$statusCode', 400] }
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          requests: {
            $sum: {
              $cond: [false, '$count', '$count']
            }
          },
          errors: {
            $sum: {
              $cond: ['$_id.isError', '$count', 0]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Format for chart
    const result = [];
    for (let i = 0; i < days; i++) {
      const date = moment().subtract(i, 'days').format('YYYY-MM-DD');
      const data = usage.find(u => u._id === date);
      result.unshift({
        date: date,
        requests: data?.requests || 0,
        errors: data?.errors || 0
      });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getTopApis = async (req, res) => {
  try {
    const userId = req.userId;
    const userApis = await require('../models/Api').find({ userId });
    const apiIds = userApis.map(api => api._id);
    
    const topApis = await UsageLog.aggregate([
      {
        $match: {
          apiId: { $in: apiIds },
          timestamp: { $gte: moment().startOf('month').toDate() }
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
      { $unwind: '$api' },
      { $sort: { requests: -1 } },
      { $limit: 5 }
    ]);
    
    res.json(topApis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getDashboardStats, getDailyUsage, getTopApis };