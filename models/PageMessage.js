const mongoose = require('mongoose');

const pageMessageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PageChat',
    required: true,
    index: true
  },
  pageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Page',
    required: true,
    index: true
  },
  // userId (string) of the sender — either the user or the page owner
  senderId: {
    type: String,
    required: true,
    index: true
  },
  // Who sent the message: 'user' (the follower) or 'page' (the page owner replying)
  senderType: {
    type: String,
    enum: ['user', 'page'],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'system'],
    default: 'text'
  },
  imageUrl: {
    type: String,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  // Soft delete support
  deletedFor: [{
    type: String // userIds who deleted this message from their view
  }]
}, {
  timestamps: true
});

// Compound indexes for efficient querying
pageMessageSchema.index({ chatId: 1, timestamp: -1 });
pageMessageSchema.index({ pageId: 1, timestamp: -1 });

// Static: get messages in a conversation
pageMessageSchema.statics.getConversation = async function(chatId, skip = 0, limit = 50) {
  return this.find({ chatId })
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

// Static: mark messages as read
pageMessageSchema.statics.markAsRead = async function(chatId, readerType) {
  // Mark messages from the OTHER party as read
  const senderType = readerType === 'user' ? 'page' : 'user';
  return this.updateMany(
    { chatId, senderType, status: { $ne: 'read' } },
    { $set: { status: 'read' } }
  );
};

const PageMessage = mongoose.model('PageMessage', pageMessageSchema);

module.exports = PageMessage;
