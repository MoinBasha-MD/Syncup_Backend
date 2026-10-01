const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const meetupController = require('../controllers/meetupController');

/**
 * Meetup routes — shared destination + mutual live tracking.
 * All routes require auth.
 */

// Specific paths before /:id
router.get('/mine', protect, meetupController.listMyMeetups);
router.post('/join/:inviteToken', protect, meetupController.joinByToken);

router.post('/', protect, meetupController.createMeetup);
router.get('/:id', protect, meetupController.getMeetup);
router.post('/:id/respond', protect, meetupController.respondToMeetup);
router.post('/:id/invite', protect, meetupController.inviteMore);
router.post('/:id/end', protect, meetupController.endMeetup);

module.exports = router;
