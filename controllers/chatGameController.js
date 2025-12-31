const ChatGame = require('../models/ChatGame');
const User = require('../models/userModel');

// Create a new game invitation
const createGame = async (req, res) => {
  try {
    const { chatId, opponentUserId } = req.body;
    const creatorUserId = req.user.userId;

    console.log('🎮 [GAME] Creating game:', { creatorUserId, opponentUserId, chatId });

    // Validate opponent exists
    const opponent = await User.findOne({ userId: opponentUserId });
    if (!opponent) {
      return res.status(404).json({
        success: false,
        message: 'Opponent not found'
      });
    }

    // Get creator info
    const creator = await User.findOne({ userId: creatorUserId });

    // Check if there's already a pending game between these users
    const existingGame = await ChatGame.findOne({
      chatId,
      status: 'pending',
      $or: [
        { player1: creatorUserId, player2: opponentUserId },
        { player1: opponentUserId, player2: creatorUserId }
      ]
    });

    if (existingGame) {
      return res.status(400).json({
        success: false,
        message: 'A game invitation is already pending'
      });
    }

    // Generate unique game ID
    const gameId = ChatGame.generateGameId();

    // Create new game (auto-start immediately)
    const game = new ChatGame({
      gameId,
      chatId,
      gameType: 'tictactoe',
      player1: creatorUserId,
      player1Name: creator.name,
      player2: opponentUserId,
      player2Name: opponent.name,
      board: Array(9).fill(''),
      currentTurn: creatorUserId, // Creator goes first
      status: 'active', // Start immediately, no acceptance needed
      acceptedAt: new Date()
    });

    await game.save();

    console.log('✅ [GAME] Game created and started:', gameId);

    // Send WebSocket invitation to opponent
    try {
      const { getSocketManager } = require('../socketManager');
      const io = getSocketManager();
      
      if (io) {
        const gameData = {
          gameId,
          game,
          from: creatorUserId,
          fromName: creator.name,
          to: opponentUserId,
          gameType: 'tictactoe',
          chatId
        };
        
        // Notify both players that game has started
        io.to(creatorUserId).emit('game:started', gameData);
        io.to(opponentUserId).emit('game:started', gameData);
        console.log('📤 [GAME] Game started notification sent to both players');
        console.log('📤 [GAME] Game data:', { gameId, status: 'active', currentTurn: creatorUserId });
      }
    } catch (socketError) {
      console.error('⚠️ [GAME] Failed to send WebSocket invitation:', socketError);
    }

    // Send FCM notification as backup (in case user doesn't have chat open)
    try {
      const fcmNotificationService = require('../services/fcmNotificationService');
      await fcmNotificationService.sendWakeupNotification(opponentUserId, {
        senderId: creatorUserId,
        senderName: creator.name,
        messagePreview: `🎮 ${creator.name} wants to play Tic-Tac-Toe!`,
        messageId: gameId
      });
      console.log('📱 [GAME] FCM notification sent to opponent');
    } catch (fcmError) {
      console.error('⚠️ [GAME] Failed to send FCM notification:', fcmError);
    }

    res.status(201).json({
      success: true,
      gameId,
      game
    });

  } catch (error) {
    console.error('❌ [GAME] Create game error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create game',
      error: error.message
    });
  }
};

// Accept game invitation
const acceptGame = async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.userId;

    console.log('🎮 [GAME] Accepting game:', { gameId, userId });

    const game = await ChatGame.findOne({ gameId });

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // Verify user is player2
    if (game.player2 !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not invited to this game'
      });
    }

    // Verify game is pending
    if (game.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Game is not pending'
      });
    }

    // Update game status
    game.status = 'active';
    game.acceptedAt = new Date();
    await game.save();

    console.log('✅ [GAME] Game accepted:', gameId);

    // Notify both players via WebSocket
    try {
      const { getSocketManager } = require('../socketManager');
      const io = getSocketManager();
      
      if (io) {
        io.to(game.player1).emit('game:started', {
          gameId,
          game
        });
        io.to(game.player2).emit('game:started', {
          gameId,
          game
        });
        console.log('📤 [GAME] Game started notification sent to both players');
      }
    } catch (socketError) {
      console.error('⚠️ [GAME] Failed to send game started notification:', socketError);
    }

    res.json({
      success: true,
      game
    });

  } catch (error) {
    console.error('❌ [GAME] Accept game error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept game',
      error: error.message
    });
  }
};

// Make a move
const makeMove = async (req, res) => {
  try {
    const { gameId } = req.params;
    const { position } = req.body;
    const userId = req.user.userId;

    console.log('🎮 [GAME] Making move:', { gameId, userId, position });

    // Validate position
    if (position < 0 || position > 8) {
      return res.status(400).json({
        success: false,
        message: 'Invalid position'
      });
    }

    const game = await ChatGame.findOne({ gameId });

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // Validate game is active
    if (game.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Game is not active'
      });
    }

    // Validate it's player's turn
    if (game.currentTurn !== userId) {
      return res.status(400).json({
        success: false,
        message: 'Not your turn'
      });
    }

    // Validate cell is empty
    if (game.board[position] !== '') {
      return res.status(400).json({
        success: false,
        message: 'Cell already occupied'
      });
    }

    // Make the move
    const symbol = game.getPlayerSymbol(userId);
    game.board[position] = symbol;

    // Record move
    game.moves.push({
      player: userId,
      position,
      symbol,
      timestamp: new Date()
    });

    // Check for winner or draw
    const result = ChatGame.checkWinner(game.board);

    if (result.winner) {
      game.status = 'finished';
      game.winner = userId;
      game.winningLine = result.line;
      game.finishedAt = new Date();
      console.log('🏆 [GAME] Winner:', userId);
    } else if (result.draw) {
      game.status = 'finished';
      game.finishedAt = new Date();
      console.log('🤝 [GAME] Draw');
    } else {
      // Switch turn
      game.currentTurn = game.getOpponent(userId);
    }

    await game.save();

    console.log('✅ [GAME] Move made:', { position, symbol, status: game.status });

    // Broadcast move to opponent via WebSocket
    try {
      const { getSocketManager } = require('../socketManager');
      const io = getSocketManager();
      
      if (io) {
        const opponentId = game.getOpponent(userId);
        io.to(opponentId).emit('game:move', {
          gameId,
          position,
          symbol,
          board: game.board,
          currentTurn: game.currentTurn,
          status: game.status,
          winner: game.winner,
          winningLine: game.winningLine
        });
        console.log('📤 [GAME] Move broadcast to opponent:', opponentId);
      }
    } catch (socketError) {
      console.error('⚠️ [GAME] Failed to broadcast move:', socketError);
    }

    res.json({
      success: true,
      game,
      isWinner: !!result.winner,
      isDraw: !!result.draw
    });

  } catch (error) {
    console.error('❌ [GAME] Make move error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to make move',
      error: error.message
    });
  }
};

// Decline or cancel game
const cancelGame = async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.userId;

    console.log('🎮 [GAME] Cancelling game:', { gameId, userId });

    const game = await ChatGame.findOne({ gameId });

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // Verify user is a player
    if (game.player1 !== userId && game.player2 !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not a player in this game'
      });
    }

    // Can only cancel pending or active games
    if (game.status === 'finished' || game.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Game already finished or cancelled'
      });
    }

    game.status = 'cancelled';
    game.finishedAt = new Date();
    await game.save();

    console.log('✅ [GAME] Game cancelled:', gameId);

    // Notify opponent via WebSocket
    try {
      const { getSocketManager } = require('../socketManager');
      const io = getSocketManager();
      
      if (io) {
        const opponentId = game.getOpponent(userId);
        io.to(opponentId).emit('game:cancelled', {
          gameId,
          cancelledBy: userId
        });
        console.log('📤 [GAME] Cancellation notification sent to:', opponentId);
      }
    } catch (socketError) {
      console.error('⚠️ [GAME] Failed to send cancellation notification:', socketError);
    }

    res.json({
      success: true,
      message: 'Game cancelled'
    });

  } catch (error) {
    console.error('❌ [GAME] Cancel game error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel game',
      error: error.message
    });
  }
};

// Get active games for a chat
const getChatGames = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.userId;

    console.log('🎮 [GAME] Getting games for chat:', chatId);

    const games = await ChatGame.find({
      chatId,
      $or: [
        { player1: userId },
        { player2: userId }
      ],
      status: { $in: ['pending', 'active'] }
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      games
    });

  } catch (error) {
    console.error('❌ [GAME] Get chat games error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get games',
      error: error.message
    });
  }
};

// Get game by ID
const getGame = async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.userId;

    const game = await ChatGame.findOne({ gameId });

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // Verify user is a player
    if (game.player1 !== userId && game.player2 !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not a player in this game'
      });
    }

    res.json({
      success: true,
      game
    });

  } catch (error) {
    console.error('❌ [GAME] Get game error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get game',
      error: error.message
    });
  }
};

// Get user game statistics
const getUserStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    const stats = await ChatGame.aggregate([
      {
        $match: {
          $or: [{ player1: userId }, { player2: userId }],
          status: 'finished'
        }
      },
      {
        $group: {
          _id: null,
          totalGames: { $sum: 1 },
          wins: {
            $sum: {
              $cond: [{ $eq: ['$winner', userId] }, 1, 0]
            }
          },
          draws: {
            $sum: {
              $cond: [{ $eq: ['$winner', null] }, 1, 0]
            }
          }
        }
      }
    ]);

    const result = stats[0] || { totalGames: 0, wins: 0, draws: 0 };
    const losses = result.totalGames - result.wins - result.draws;

    res.json({
      success: true,
      stats: {
        totalGames: result.totalGames,
        wins: result.wins,
        losses,
        draws: result.draws
      }
    });

  } catch (error) {
    console.error('❌ [GAME] Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get statistics',
      error: error.message
    });
  }
};

module.exports = {
  createGame,
  acceptGame,
  makeMove,
  cancelGame,
  getChatGames,
  getGame,
  getUserStats
};
