const mongoose = require('mongoose');

/**
 * Group Chat Schema - For messaging groups (like WhatsApp groups)
 * This is different from groupModel.js which is for contact organization
 */
const groupChatSchema = mongoose.Schema(
  {
    groupId: {
      type: String,
      unique: true,
      index: true,
      default: () => require('crypto').randomUUID()
    },
    groupName: {
      type: String,
      required: [true, 'Please add a group name'],
      trim: true,
      maxlength: [100, 'Group name cannot exceed 100 characters']
    },
    description: {
      type: String,
      default: '',
      maxlength: [500, 'Description cannot exceed 500 characters']
    },
    groupImage: {
      type: String,
      default: '' // URL to group profile image
    },
    // Creator of the group chat
    createdBy: {
      type: String,
      required: true,
      index: true
    },
    // Array of admin user IDs
    admins: [{
      type: String,
      required: true
    }],
    // Array of member user IDs
    members: [{
      type: String,
      required: true
    }],
    // Group settings
    settings: {
      onlyAdminsCanMessage: {
        type: Boolean,
        default: false
      },
      onlyAdminsCanAddMembers: {
        type: Boolean,
        default: false
      },
      onlyAdminsCanEditGroupInfo: {
        type: Boolean,
        default: true
      },
      disappearingMessages: {
        enabled: {
          type: Boolean,
          default: false
        },
        duration: {
          type: Number,
          default: 604800 // 7 days in seconds
        }
      },
      muteNotifications: {
        type: Boolean,
        default: false
      }
    },
    // Metadata
    memberCount: {
      type: Number,
      default: 0
    },
    lastActivity: {
      type: Date,
      default: Date.now
    },
    lastMessage: {
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GroupMessage'
      },
      text: String,
      senderId: {
        type: String
      },
      senderName: String,
      timestamp: Date,
      messageType: {
        type: String,
        enum: ['text', 'image', 'file', 'audio', 'video', 'gif', 'voice'],
        default: 'text'
      }
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
  }
);

// Update member count and ensure creator is admin before saving
groupChatSchema.pre('save', function(next) {
  this.memberCount = this.members.length;
  this.lastActivity = new Date();
  
  // Ensure creator is always in admins and members array
  if (this.createdBy && !this.admins.includes(this.createdBy)) {
    this.admins.push(this.createdBy);
  }
  if (this.createdBy && !this.members.includes(this.createdBy)) {
    this.members.push(this.createdBy);
  }
  
  next();
});

// Create indexes for efficient queries
groupChatSchema.index({ createdBy: 1, createdAt: -1 }); // Creator's groups by creation date
groupChatSchema.index({ members: 1, lastActivity: -1 }); // User's groups by activity
groupChatSchema.index({ admins: 1 }); // Find groups by admin
groupChatSchema.index({ lastActivity: -1 }); // Sort by activity
groupChatSchema.index({ groupName: 'text', description: 'text' }); // Text search

// Instance methods
groupChatSchema.methods.addMember = function(userId) {
  if (!this.members.includes(userId)) {
    this.members.push(userId);
    this.memberCount = this.members.length;
    this.lastActivity = new Date();
  }
  return this;
};

groupChatSchema.methods.removeMember = function(userId) {
  this.members = this.members.filter(member => member !== userId);
  // Also remove from admins if they were admin
  this.admins = this.admins.filter(admin => admin !== userId);
  this.memberCount = this.members.length;
  this.lastActivity = new Date();
  return this;
};

groupChatSchema.methods.isMember = function(userId) {
  return this.members.some(member => member === userId);
};

groupChatSchema.methods.isAdmin = function(userId) {
  return this.admins.some(admin => admin === userId);
};

groupChatSchema.methods.promoteToAdmin = function(userId) {
  if (this.isMember(userId) && !this.isAdmin(userId)) {
    this.admins.push(userId);
  }
  return this;
};

groupChatSchema.methods.demoteFromAdmin = function(userId) {
  // Don't allow demoting the creator
  if (userId !== this.createdBy) {
    this.admins = this.admins.filter(admin => admin !== userId);
  }
  return this;
};

groupChatSchema.methods.updateLastMessage = function(message) {
  this.lastMessage = {
    messageId: message._id,
    text: message.message,
    senderId: message.senderId,
    senderName: message.senderName,
    timestamp: message.createdAt,
    messageType: message.messageType
  };
  this.lastActivity = new Date();
  return this;
};

// Static methods
groupChatSchema.statics.findUserGroups = function(userId) {
  return this.find({ 
    members: { $in: [userId] },
    isActive: true 
  }).sort({ lastActivity: -1 });
};

groupChatSchema.statics.findByGroupId = function(groupId) {
  return this.findOne({ groupId, isActive: true })
    .populate('members', 'name profileImage phoneNumber')
    .populate('admins', 'name profileImage phoneNumber')
    .populate('createdBy', 'name profileImage phoneNumber');
};

const GroupChat = mongoose.model('GroupChat', groupChatSchema);

module.exports = GroupChat;
