const mongoose = require('mongoose');

const pageChatSchema = new mongoose.Schema({
  pageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Page',
    required: true,
    index: true
  },
  // The user messaging the page (stored as string userId, matching Message model pattern)
  userId: {
    type: String,
    required: true,
    index: true
  },
  // Last message preview for conversation list
  lastMessage: {
    type: String,
    default: ''
  },
  lastMessageAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  // Unread count for the user (messages from page owner that user hasn't read)
  userUnreadCount: {
    type: Number,
    default: 0
  },
  // Unread count for the page owner (messages from user that owner hasn't read)
  ownerUnreadCount: {
    type: Number,
    default: 0
  },
  // Whether the user has archived this conversation
  userArchived: {
    type: Boolean,
    default: false
  },
  // Whether the page owner has archived this conversation
  ownerArchived: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Compound index: one conversation per user per page
pageChatSchema.index({ pageId: 1, userId: 1 }, { unique: true });

// Static: find or create a chat between a user and a page
pageChatSchema.statics.findOrCreate = async function(pageId, userId) {
  let chat = await this.findOne({ pageId, userId });
  if (!chat) {
    chat = await this.create({ pageId, userId });
  }
  return chat;
};

// Static: get conversations for a user (all pages they've messaged)
pageChatSchema.statics.getUserConversations = async function(userId, skip = 0, limit = 50) {
  return this.find({ userId, userArchived: false })
    .sort({ lastMessageAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('pageId', 'name username profileImage pageType isVerified')
    .lean();
};

// Static: get conversations for a page owner (all users who messaged their pages)
pageChatSchema.statics.getPageConversations = async function(pageIds, skip = 0, limit = 50) {
  return this.find({ pageId: { $in: pageIds }, ownerArchived: false })
    .sort({ lastMessageAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('pageId', 'name username profileImage pageType isVerified')
    .lean();
};

const PageChat = mongoose.model('PageChat', pageChatSchema);

module.exports = PageChat;
