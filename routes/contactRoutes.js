const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { cache } = require('../middleware/cacheMiddleware');
const contactController = require('../controllers/contactController');

// Base routes
router.route('/')
  .get(protect, contactController.getContacts)
  .post(protect, contactController.addContact);

// Get contacts with status
router.route('/with-status')
  .get(protect, contactController.getContactsWithStatus);

// Sync device contacts with registered users
router.route('/sync')
  .post(protect, contactController.syncContacts);

// Filter contacts by phone numbers
router.route('/filter')
  .post(protect, contactController.filterContacts);

// Individual contact routes
router.route('/:id')
  .delete(protect, contactController.removeContact);

// Contact status route
router.route('/:id/status')
  .get(protect, contactController.getContactStatus);

// Cached contacts routes
router.route('/cached')
  .get(protect, contactController.getCachedContacts);

router.route('/cache')
  .post(protect, contactController.saveCachedContacts);

router.route('/sync-status')
  .get(protect, contactController.getContactSyncStatus);

// Get status by phone number
router.get('/phone/:phoneNumber/status', protect, contactController.getStatusByPhone);

// Get status for a list of contacts
router.post('/status-list', protect, cache(60), contactController.getStatusForContactsList);

module.exports = router;
