const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify token with proper error handling
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('✅ Token verified for user ID:', decoded.userId);
    } catch (err) {
      console.log('❌ Token verification failed:', err.message);
      
      // Check if token is expired
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired. Please login again.' });
      }
      
      return res.status(401).json({ error: 'Invalid token. Please login again.' });
    }
    
    // Get user from database
    const user = await User.findById(decoded.userId).select('-password -refreshToken');
    
    if (!user) {
      console.log('❌ User not found:', decoded.userId);
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    console.error('❌ Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

const roleMiddleware = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      console.log(`❌ Role denied: ${req.user.role} not in [${allowedRoles.join(', ')}]`);
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};

module.exports = { authMiddleware, roleMiddleware };