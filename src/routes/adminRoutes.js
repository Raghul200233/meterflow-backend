const express = require('express');
const {
  getAdminStats,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  getAllApis,
  getTopApis,
  getUsersByRole
} = require('../controllers/adminController');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authMiddleware);
router.use(roleMiddleware('admin'));

router.get('/stats', getAdminStats);
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.get('/apis', getAllApis);
router.get('/top-apis', getTopApis);
router.get('/users-by-role', getUsersByRole);

module.exports = router;