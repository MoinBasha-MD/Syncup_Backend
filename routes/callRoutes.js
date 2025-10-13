const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getCallHistory,
  getMissedCalls,
  markMissedCallsAsSeen,
  markCallAsSeen,
  deleteCall,
  getCallStats,
  getCallDetails
} = require('../controllers/callController');

// All routes are protected
router.use(protect);

// Call history
router.get('/history', getCallHistory);

// Missed calls
router.get('/missed', getMissedCalls);
router.post('/missed/mark-seen', markMissedCallsAsSeen);

// Call statistics
router.get('/stats', getCallStats);

// Single call operations
router.get('/:callId', getCallDetails);
router.post('/:callId/mark-seen', markCallAsSeen);
router.delete('/:callId', deleteCall);

module.exports = router;
