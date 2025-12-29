const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const chatGameController = require('../controllers/chatGameController');

// All routes require authentication
router.use(protect);

// Create game invitation
router.post('/create', chatGameController.createGame);

// Accept game invitation
router.post('/:gameId/accept', chatGameController.acceptGame);

// Make a move
router.post('/:gameId/move', chatGameController.makeMove);

// Cancel/decline game
router.post('/:gameId/cancel', chatGameController.cancelGame);

// Get active games for a chat
router.get('/chat/:chatId', chatGameController.getChatGames);

// Get specific game
router.get('/:gameId', chatGameController.getGame);

// Get user statistics
router.get('/stats/me', chatGameController.getUserStats);

module.exports = router;
