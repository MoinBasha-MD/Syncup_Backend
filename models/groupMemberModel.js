const mongoose = require('mongoose');

/**
 * Group Member Schema - For tracking member-specific data in group chats
 */
const groupMemberSchema = mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GroupChat',
      required: true,
      index: true
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member'
    },
    // Member permissions
    permissions: {
      canSendMessages: {
        type: Boolean,
        default: true
      },
      canAddMembers: {
        type: Boolean,
        default: false
      },
      canRemoveMembers: {
        type: Boolean,
        default: false
      },
      canEditGroupInfo: {
        type: Boolean,
        default: false
      },
      canDeleteMessages: {
        type: Boolean,
        default: false
      }
    },
    // Notification settings
    notificationSettings: {
      muted: {
        type: Boolean,
        default: false
      },
      mutedUntil: {
        type: Date,
        default: null
      },
      soundEnabled: {
        type: Boolean,
        default: true
      },
      vibrationEnabled: {
        type: Boolean,
        default: true
      }
    },
    // Member activity tracking
    joinedAt: {
      type: Date,
      default: Date.now
    },
    addedBy: {
      type: String,
      required: true
    },
    lastSeenAt: {
      type: Date,
      default: Date.now
    },
    lastSeenMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GroupMessage',
      default: null
    },
    // Member status
    isActive: {
      type: Boolean,
      default: true
    },
    leftAt: {
      type: Date,
      default: null
    },
    removedAt: {
      type: Date,
      default: null
    },
    removedBy: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true,
  }
);

// Create compound indexes
groupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true }); // Unique member per group
groupMemberSchema.index({ groupId: 1, role: 1 }); // Find admins/members
groupMemberSchema.index({ userId: 1, isActive: 1 }); // User's active groups
groupMemberSchema.index({ groupId: 1, isActive: 1 }); // Active members in group
groupMemberSchema.index({ groupId: 1, lastSeenAt: -1 }); // Member activity

// Instance methods
groupMemberSchema.methods.promoteToAdmin = function() {
  this.role = 'admin';
  this.permissions = {
    canSendMessages: true,
    canAddMembers: true,
    canRemoveMembers: true,
    canEditGroupInfo: true,
    canDeleteMessages: true
  };
  return this;
};

groupMemberSchema.methods.demoteToMember = function() {
  this.role = 'member';
  this.permissions = {
    canSendMessages: true,
    canAddMembers: false,
    canRemoveMembers: false,
    canEditGroupInfo: false,
    canDeleteMessages: false
  };
  return this;
};

groupMemberSchema.methods.muteNotifications = function(duration = null) {
  this.notificationSettings.muted = true;
  if (duration) {
    this.notificationSettings.mutedUntil = new Date(Date.now() + duration);
  }
  return this;
};

groupMemberSchema.methods.unmuteNotifications = function() {
  this.notificationSettings.muted = false;
  this.notificationSettings.mutedUntil = null;
  return this;
};

groupMemberSchema.methods.updateLastSeen = function(messageId = null) {
  this.lastSeenAt = new Date();
  if (messageId) {
    this.lastSeenMessageId = messageId;
  }
  return this;
};

groupMemberSchema.methods.leaveGroup = function() {
  this.isActive = false;
  this.leftAt = new Date();
  return this;
};

groupMemberSchema.methods.removeFromGroup = function(removedBy) {
  this.isActive = false;
  this.removedAt = new Date();
  this.removedBy = removedBy;
  return this;
};

// Static methods
groupMemberSchema.statics.findGroupMembers = function(groupId, activeOnly = true) {
  const query = { groupId };
  if (activeOnly) {
    query.isActive = true;
  }
  
  return this.find(query)
    .sort({ role: -1, joinedAt: 1 }); // Admins first, then by join date
};

groupMemberSchema.statics.findGroupAdmins = function(groupId) {
  return this.find({ 
    groupId, 
    role: 'admin', 
    isActive: true 
  });
};

groupMemberSchema.statics.findUserGroups = function(userId, activeOnly = true) {
  const query = { userId };
  if (activeOnly) {
    query.isActive = true;
  }
  
  return this.find(query)
    .populate('groupId', 'groupName groupImage lastActivity memberCount')
    .sort({ 'groupId.lastActivity': -1 });
};

groupMemberSchema.statics.isMember = function(groupId, userId) {
  return this.findOne({ 
    groupId, 
    userId, 
    isActive: true 
  });
};

groupMemberSchema.statics.isAdmin = function(groupId, userId) {
  return this.findOne({ 
    groupId, 
    userId, 
    role: 'admin', 
    isActive: true 
  });
};

groupMemberSchema.statics.getUnreadCount = function(groupId, userId) {
  return this.findOne({ groupId, userId, isActive: true })
    .then(member => {
      if (!member) return 0;
      
      const GroupMessage = mongoose.model('GroupMessage');
      const query = {
        groupId,
        deletedAt: null,
        senderId: { $ne: userId } // Don't count own messages
      };
      
      if (member.lastSeenMessageId) {
        query._id = { $gt: member.lastSeenMessageId };
      }
      
      return GroupMessage.countDocuments(query);
    });
};

const GroupMember = mongoose.model('GroupMember', groupMemberSchema);

module.exports = GroupMember;
