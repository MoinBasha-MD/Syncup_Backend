const mongoose = require('mongoose');

const moveSchema = new mongoose.Schema({
  player: {
    type: String,
    required: true
  },
  position: {
    type: Number,
    required: true,
    min: 0,
    max: 8
  },
  symbol: {
    type: String,
    enum: ['X', 'O'],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const chatGameSchema = new mongoose.Schema({
  gameId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  chatId: {
    type: String,
    required: true,
    index: true
  },
  gameType: {
    type: String,
    default: 'tictactoe',
    enum: ['tictactoe']
  },
  player1: {
    type: String,
    required: true,
    index: true
  },
  player1Name: {
    type: String,
    required: true
  },
  player2: {
    type: String,
    required: true,
    index: true
  },
  player2Name: {
    type: String
  },
  board: [{
    type: String,
    default: ''
  }],
  currentTurn: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'finished', 'cancelled'],
    default: 'pending',
    index: true
  },
  winner: {
    type: String,
    default: null
  },
  winningLine: [{
    type: Number
  }],
  moves: [moveSchema],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  acceptedAt: {
    type: Date
  },
  finishedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Index for finding active games
chatGameSchema.index({ status: 1, createdAt: -1 });
chatGameSchema.index({ player1: 1, status: 1 });
chatGameSchema.index({ player2: 1, status: 1 });

// Static method to generate unique game ID
chatGameSchema.statics.generateGameId = function() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
};

// Static method to check for winner
chatGameSchema.statics.checkWinner = function(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
    [0, 4, 8], [2, 4, 6]             // Diagonals
  ];
  
  for (const line of lines) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  
  // Check for draw (all cells filled)
  if (board.every(cell => cell !== '')) {
    return { draw: true };
  }
  
  return { winner: null, draw: false, line: null };
};

// Method to check if game is finished
chatGameSchema.methods.isFinished = function() {
  return this.status === 'finished' || this.status === 'cancelled';
};

// Method to get opponent for a given player
chatGameSchema.methods.getOpponent = function(playerId) {
  return this.player1 === playerId ? this.player2 : this.player1;
};

// Method to get symbol for a player
chatGameSchema.methods.getPlayerSymbol = function(playerId) {
  return this.player1 === playerId ? 'X' : 'O';
};

// Auto-cancel pending games after 24 hours
chatGameSchema.index({ createdAt: 1 }, { 
  expireAfterSeconds: 86400,
  partialFilterExpression: { status: 'pending' }
});

module.exports = mongoose.model('ChatGame', chatGameSchema);
