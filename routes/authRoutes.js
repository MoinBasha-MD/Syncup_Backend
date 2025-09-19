const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  checkUserExists
} = require('../controllers/authController');

// Authentication routes - all public
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/check', checkUserExists);

module.exports = router;
