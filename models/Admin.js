const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 50
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  email: {
    type: String,
    required: false,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true
  },
  role: {
    type: String,
    enum: ['owner', 'super_admin', 'admin', 'moderator', 'viewer'],
    default: 'admin'
  },
  grants: {
    type: [String],
    default: []
  },
  tokenVersion: {
    type: Number,
    default: 0
  },
  totp: {
    secretEnc: {
      type: String,
      select: false
    },
    pendingSecretEnc: {
      type: String,
      select: false
    },
    enabled: {
      type: Boolean,
      default: false
    },
    recoveryCodes: {
      type: [String],
      select: false,
      default: []
    },
    lastUsedStep: {
      type: Number,
      select: false
    }
  },
  enrollment: {
    codeHash: {
      type: String,
      select: false
    },
    expiresAt: Date
  },
  devices: [{
    deviceId: String,
    name: String,
    publicKey: String,
    status: {
      type: String,
      enum: ['pending', 'approved', 'revoked'],
      default: 'pending'
    },
    approvedAt: Date,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    },
    lastSeenAt: Date,
    revokedAt: Date
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: null
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  permissions: {
    canManageUsers: { type: Boolean, default: true },
    canManagePosts: { type: Boolean, default: true },
    canManageBroadcasts: { type: Boolean, default: true },
    canManageHashtags: { type: Boolean, default: true },
    canManageAnalytics: { type: Boolean, default: true },
    canManageAdmins: { type: Boolean, default: false }
  }
}, {
  timestamps: true
});

// At most one owner account can ever exist
adminSchema.index({ role: 1 }, { unique: true, partialFilterExpression: { role: 'owner' } });

// Remember the persisted role so the pre-save guard can detect owner mutations
adminSchema.post('init', function() {
  this._originalRole = this.role;
});

// Owner invariants: an owner can never be demoted or deactivated
adminSchema.pre('save', function(next) {
  const originalRole = this._originalRole;
  if (this.isNew) {
    this._originalRole = this.role;
  }
  if (originalRole === 'owner') {
    if (this.role !== 'owner') {
      return next(new Error('The owner account cannot be demoted'));
    }
    if (this.isActive === false) {
      return next(new Error('The owner account cannot be deactivated'));
    }
  }
  return next();
});

// Owner accounts cannot be deleted — document or query path
adminSchema.pre('deleteOne', { document: true, query: false }, function(next) {
  if (this.role === 'owner') {
    return next(new Error('The owner account cannot be deleted'));
  }
  return next();
});

const refuseOwnerQueryDelete = async function(next) {
  try {
    const target = await this.model.findOne(this.getFilter()).select('role').lean();
    if (target && target.role === 'owner') {
      return next(new Error('The owner account cannot be deleted'));
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

adminSchema.pre('deleteOne', { document: false, query: true }, refuseOwnerQueryDelete);
adminSchema.pre('findOneAndDelete', refuseOwnerQueryDelete);

// Owner invariants for update queries: nobody can promote to 'owner' or
// demote/deactivate the owner through updateOne/updateMany/findOneAndUpdate.
// (The CLI owner-creation path uses `new Admin(...).save()`, not updates.)
const flattenUpdate = (update = {}) => {
  const merged = {};
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith('$')) Object.assign(merged, value);
    else merged[key] = value;
  }
  return merged;
};

const refuseOwnerQueryUpdate = async function(next) {
  try {
    const update = flattenUpdate(this.getUpdate());
    const demotes = 'role' in update && update.role !== 'owner';
    const deactivates = update.isActive === false;
    if ('role' in update && update.role === 'owner') {
      return next(new Error('The owner role cannot be assigned through updates'));
    }
    if (demotes || deactivates) {
      const target = await this.model.findOne(this.getFilter()).select('role').lean();
      if (target && target.role === 'owner') {
        return next(new Error('The owner account cannot be modified through updates'));
      }
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

adminSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], refuseOwnerQueryUpdate);

// Guard for controllers/services mutating an admin document
adminSchema.statics.assertNotOwnerMutation = function(adminDoc) {
  if (adminDoc && adminDoc.role === 'owner') {
    throw new Error('The owner account cannot be modified through this operation');
  }
};

// Hash password before saving
adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
adminSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

// Method to check if account is locked
adminSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Method to increment login attempts
adminSchema.methods.incLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  
  // Otherwise increment
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock the account after 5 failed attempts for 2 hours
  const maxAttempts = 5;
  const lockTime = 2 * 60 * 60 * 1000; // 2 hours
  
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + lockTime };
  }
  
  return this.updateOne(updates);
};

// Method to reset login attempts
adminSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

// Static method to check if any admin exists
adminSchema.statics.hasAdmins = async function() {
  const count = await this.countDocuments();
  return count > 0;
};

module.exports = mongoose.model('Admin', adminSchema);
