const mongoose = require('mongoose');

/**
 * Contact Group Schema for organizing user contacts
 */
const groupSchema = mongoose.Schema(
  {
    groupId: {
      type: String,
      unique: true,
      index: true,
      default: () => require('crypto').randomUUID()
    },
    name: {
      type: String,
      required: [true, 'Please add a group name'],
      trim: true,
      maxlength: [50, 'Group name cannot exceed 50 characters']
    },
    description: {
      type: String,
      default: '',
      maxlength: [200, 'Description cannot exceed 200 characters']
    },
    // Owner of the group
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    // Members of the group (unified contacts and app connections)
    members: [{
      memberId: {
        type: String,
        required: true,
        index: true
      },
      memberType: {
        type: String,
        enum: ['contact', 'app_connection'],
        required: true
      },
      phoneNumber: {
        type: String,
        required: function() {
          return this.memberType === 'contact';
        }
      },
      userId: {
        type: String,
        required: function() {
          return this.memberType === 'app_connection';
        }
      },
      name: {
        type: String,
        required: true
      },
      profileImage: {
        type: String,
        default: ''
      },
      role: {
        type: String,
        enum: ['admin', 'member'],
        default: 'member'
      },
      addedAt: {
        type: Date,
        default: Date.now
      },
      addedBy: {
        type: String,
        required: true
      }
    }],
    // Group creator (automatically becomes first admin)
    createdBy: {
      type: String,
      required: true,
      index: true
    },
    // Array of member IDs who are admins
    admins: [{
      type: String,
      required: true
    }],
    // Group settings
    settings: {
      isPrivate: {
        type: Boolean,
        default: true
      },
      allowMemberInvites: {
        type: Boolean,
        default: false
      },
      requireAdminApproval: {
        type: Boolean,
        default: true
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
    }
  },
  {
    timestamps: true,
  }
);

// Update member count and ensure creator is admin before saving
groupSchema.pre('save', function(next) {
  // ✅ FIX Bug #2: Remove duplicate members before saving
  const uniqueMembers = [];
  const seenIds = new Set();
  
  for (const member of this.members) {
    const memberId = member.memberId || member.userId || member.phoneNumber;
    if (memberId && !seenIds.has(memberId)) {
      seenIds.add(memberId);
      uniqueMembers.push(member);
    }
  }
  
  this.members = uniqueMembers;
  this.memberCount = this.members.length;
  this.lastActivity = new Date();
  
  // Ensure creator is always in admins array
  if (this.createdBy && !this.admins.includes(this.createdBy)) {
    this.admins.push(this.createdBy);
  }
  
  next();
});

// Create indexes for efficient queries
groupSchema.index({ userId: 1, name: 1 }, { unique: true }); // Unique group name per user
groupSchema.index({ userId: 1, createdAt: -1 }); // User's groups by creation date
groupSchema.index({ 'members.phoneNumber': 1 }); // Find groups by member phone number
groupSchema.index({ 'members.userId': 1 }); // Find groups by app connection userId
groupSchema.index({ 'members.memberId': 1 }); // Find groups by unified memberId
groupSchema.index({ createdBy: 1 }); // Find groups by creator
groupSchema.index({ admins: 1 }); // Find groups by admin
groupSchema.index({ lastActivity: -1 }); // Sort by activity

// Instance methods for unified member management
groupSchema.methods.addMember = function(memberData, addedBy) {
  const { memberId, memberType, phoneNumber, userId, name, profileImage, role = 'member' } = memberData;
  
  const existingMember = this.members.find(member => member.memberId === memberId);
  if (!existingMember) {
    const newMember = {
      memberId,
      memberType,
      name,
      profileImage: profileImage || '',
      role,
      addedBy,
      addedAt: new Date()
    };
    
    if (memberType === 'contact') {
      newMember.phoneNumber = phoneNumber;
    } else if (memberType === 'app_connection') {
      newMember.userId = userId;
    }
    
    this.members.push(newMember);
    this.memberCount = this.members.length;
    this.lastActivity = new Date();
  }
  return this;
};

groupSchema.methods.removeMember = function(memberId) {
  this.members = this.members.filter(member => member.memberId !== memberId);
  // Also remove from admins if they were admin
  this.admins = this.admins.filter(adminId => adminId !== memberId);
  this.memberCount = this.members.length;
  this.lastActivity = new Date();
  return this;
};

groupSchema.methods.isMember = function(memberId) {
  return this.members.some(member => member.memberId === memberId);
};

groupSchema.methods.isAdmin = function(memberId) {
  return this.admins.includes(memberId);
};

groupSchema.methods.promoteToAdmin = function(memberId) {
  if (this.isMember(memberId) && !this.isAdmin(memberId)) {
    this.admins.push(memberId);
    // Update member role
    const member = this.members.find(m => m.memberId === memberId);
    if (member) {
      member.role = 'admin';
    }
  }
  return this;
};

groupSchema.methods.demoteFromAdmin = function(memberId) {
  // Don't allow demoting the creator
  if (memberId !== this.createdBy) {
    this.admins = this.admins.filter(adminId => adminId !== memberId);
    // Update member role
    const member = this.members.find(m => m.memberId === memberId);
    if (member) {
      member.role = 'member';
    }
  }
  return this;
};

// Static methods for unified member management
groupSchema.statics.findByUserId = function(userId) {
  return this.find({ userId }).sort({ lastActivity: -1 });
};

groupSchema.statics.findByMemberPhone = function(phoneNumber) {
  return this.find({ 'members.phoneNumber': phoneNumber });
};

groupSchema.statics.findByMemberId = function(memberId) {
  return this.find({ 'members.memberId': memberId });
};

groupSchema.statics.findByAppConnectionUserId = function(userId) {
  return this.find({ 'members.userId': userId });
};

groupSchema.statics.findUserGroupsWithMember = function(userId, memberId) {
  return this.find({ 
    userId, 
    'members.memberId': memberId 
  }).sort({ lastActivity: -1 });
};

groupSchema.statics.findUserGroupsWithContact = function(userId, phoneNumber) {
  return this.find({ 
    userId, 
    'members.phoneNumber': phoneNumber 
  }).sort({ lastActivity: -1 });
};

groupSchema.statics.findUserGroupsWithAppConnection = function(userId, appUserId) {
  return this.find({ 
    userId, 
    'members.userId': appUserId 
  }).sort({ lastActivity: -1 });
};

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;
