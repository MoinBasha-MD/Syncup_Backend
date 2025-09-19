const express = require('express');
const router = express.Router();
const storyController = require('../controllers/storyController');
const { protect } = require('../middleware/authMiddleware');

// Apply auth middleware to all story routes
router.use(protect);

// POST /api/stories - Create a new story
router.post('/', storyController.createStory);

// GET /api/stories/contacts - Get active stories from user's contacts
router.get('/contacts', storyController.getContactsStories);

// POST /api/stories/contacts - Get active stories with contacts array from frontend
router.post('/contacts', storyController.getContactsStories);

// POST /api/stories/seen - Mark story as seen
router.post('/seen', storyController.markStorySeen);

// DELETE /api/stories/:id - Delete a story
router.delete('/:id', storyController.deleteStory);

// POST /api/stories/cleanup - Clean up expired and duplicate stories
router.post('/cleanup', storyController.cleanupStories);

module.exports = router;
