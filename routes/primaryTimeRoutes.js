const express = require('express');
const router = express.Router();
const primaryTimeController = require('../controllers/primaryTimeController');
const { protect } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(protect);

// Profile CRUD operations
router.post('/profiles', primaryTimeController.createProfile);
router.get('/profiles', primaryTimeController.getProfiles);
router.get('/profiles/:id', primaryTimeController.getProfile);
router.put('/profiles/:id', primaryTimeController.updateProfile);
router.delete('/profiles/:id', primaryTimeController.deleteProfile);

// Profile activation
router.post('/activate/:id', primaryTimeController.activateProfile);
router.post('/deactivate/:id', primaryTimeController.deactivateProfile);

// Get active/scheduled profiles
router.get('/active', primaryTimeController.getActiveProfile);
router.get('/scheduled', primaryTimeController.getScheduledProfiles);

module.exports = router;
