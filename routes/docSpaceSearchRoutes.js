const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const searchController = require('../controllers/docSpaceSearchController');

// All routes require authentication
router.use(protect);

// Search
router.get('/search', searchController.searchDocuments);

// Smart collections
router.get('/collections', searchController.getSmartCollections);

// Filter options
router.get('/filters', searchController.getFilterOptions);

module.exports = router;
