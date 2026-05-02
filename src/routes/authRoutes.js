const express = require('express');
const { register, login, refreshToken, logout } = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.post('/logout', authMiddleware, logout);

module.exports = router;