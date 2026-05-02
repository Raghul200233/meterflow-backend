const User = require('../models/User');
const Api = require('../models/Api');
const ApiKey = require('../models/ApiKey');
const UsageLog = require('../models/UsageLog');
const Billing = require('../models/Billing');
const mongoose = require('mongoose');

// Get admin dashboard stats
const getAdminStats = async (req, res) => {
  try {
    const [totalUsers, totalApis, totalRequests, totalRevenue, activeKeys] = await Promise.all([
      User.countDocuments(),
      Api.countDocuments(),
      UsageLog.countDocuments(),
      Billing.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      ApiKey.countDocuments({ status: 'active' })
    ]);

    res.json({
      totalUsers,
      totalApis,
      totalRequests,
      totalRevenue: totalRevenue[0]?.total || 0,
      activeKeys,
      errorRate: 0.02 // Calculate from logs
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get all users (admin only)
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password -refreshToken');
    const usersWithApiCount = await Promise.all(
      users.map(async (user) => {
        const apiCount = await Api.countDocuments({ userId: user._id });
        return { ...user.toObject(), apiCount };
      })
    );
    res.json(usersWithApiCount);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Create user (admin)
const createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new User({
      name,
      email,
      password: hashedPassword,
      role
    });
    
    await user.save();
    res.status(201).json({ message: 'User created', user: { id: user._id, name, email, role } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update user (admin)
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, password } = req.body;
    
    const updateData = { name, email, role };
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }
    
    const user = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete user (admin)
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete user's APIs, keys, usage logs
    const apis = await Api.find({ userId: id });
    for (const api of apis) {
      await ApiKey.deleteMany({ apiId: api._id });
      await UsageLog.deleteMany({ apiId: api._id });
    }
    await Api.deleteMany({ userId: id });
    await User.findByIdAndDelete(id);
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get all APIs (admin view)
const getAllApis = async (req, res) => {
  try {
    const apis = await Api.find().populate('userId', 'name email');
    res.json(apis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get top performing APIs
const getTopApis = async (req, res) => {
  try {
    const topApis = await UsageLog.aggregate([
      {
        $group: {
          _id: '$apiId',
          requests: { $sum: 1 },
          revenue: { $sum: '$cost' }
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
      { $limit: 10 },
      { $project: { name: '$api.name', requests: 1, revenue: 1 } }
    ]);
    
    res.json(topApis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get users by role
const getUsersByRole = async (req, res) => {
  try {
    const roles = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $project: { name: '$_id', value: '$count', _id: 0 } }
    ]);
    res.json(roles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAdminStats,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  getAllApis,
  getTopApis,
  getUsersByRole
};