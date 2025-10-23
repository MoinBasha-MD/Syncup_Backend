const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * User Schema with optimized indexing for frequently queried fields
 */
const userSchema = mongoose.Schema(
  {
    userId: {
      type: String,
      unique: true,
      index: true,
      default: () => crypto.randomUUID()
    },
    name: {
      type: String,
      required: [true, 'Please add a name'],
    },
    phoneNumber: {
      type: String,
      required: [true, 'Please add a phone number'],
      unique: true,
      match: [/^(\+?[1-9]\d{1,14}|\d{10})$/, 'Please enter a valid phone number'],
    },
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please add a valid email',
      ],
    },
    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: 6,
      select: false,
    },
    status: {
      type: String,
      default: 'available'
    },
    customStatus: {
      type: String,
      default: ''
    },
    statusUntil: {
      type: Date,
      default: null
    },
    // Location data for status updates
    statusLocation: {
      placeName: {
        type: String,
        default: ''
      },
      coordinates: {
        latitude: {
          type: Number,
          min: -90,
          max: 90
        },
        longitude: {
          type: Number,
          min: -180,
          max: 180
        }
      },
      address: {
        type: String,
        default: ''
      },
      shareWithContacts: {
        type: Boolean,
        default: false
      },
      timestamp: {
        type: Date,
        default: Date.now
      }
    },
    profileImage: {
      type: String,
      default: ''
    },
    dateOfBirth: {
      type: Date,
      default: null
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_to_say'],
      default: null
    },
    contacts: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    // Cached contacts for faster loading
    cachedContacts: [{
      userId: {
        type: String,
        required: true
      },
      name: {
        type: String,
        required: true
      },
      phoneNumber: {
        type: String,
        required: true
      },
      profileImage: {
        type: String,
        default: ''
      },
      isRegistered: {
        type: Boolean,
        default: true
      },
      addedAt: {
        type: Date,
        default: Date.now
      }
    }],
    contactsLastSynced: {
      type: Date,
      default: null
    },
    // Global discovery fields
    isPublic: {
      type: Boolean,
      default: false
    },
    username: {
      type: String,
      unique: true,
      sparse: true, // Allow null but enforce uniqueness when set
      minlength: 3,
      maxlength: 20,
      match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores']
    },
    searchableName: {
      type: String,
      index: true // For faster name-based searches
    },
    // App connections (non-phone contacts)
    appConnections: [{
      userId: {
        type: String,
        required: true
      },
      name: {
        type: String,
        required: true
      },
      username: {
        type: String,
        default: ''
      },
      profileImage: {
        type: String,
        default: ''
      },
      connectionDate: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['pending', 'accepted'],
        default: 'accepted'
      }
    }],
    // Saved/Bookmarked posts
    savedPosts: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FeedPost'
    }],
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    // Device tokens for push notifications and background service
    deviceTokens: [{
      token: {
        type: String,
        required: true
      },
      platform: {
        type: String,
        enum: ['android', 'ios'],
        required: true
      },
      lastActive: {
        type: Date,
        default: Date.now
      },
      isActive: {
        type: Boolean,
        default: true
      },
      registeredAt: {
        type: Date,
        default: Date.now
      }
    }],
    // Chat encryption settings
    encryptionSettings: {
      isEnabled: {
        type: Boolean,
        default: false
      },
      pinHash: {
        type: String,
        default: null,
        select: false // Don't include in regular queries for security
      },
      encryptionKey: {
        type: String,
        default: null,
        select: false // Don't include in regular queries for security
      },
      updatedAt: {
        type: Date,
        default: Date.now
      }
    },
  },
  {
    timestamps: true,
  }
);

// Normalize phone number before saving
userSchema.pre('save', async function (next) {
  // Normalize phone number - remove spaces, dashes, and handle country codes
  if (this.isModified('phoneNumber')) {
    let normalizedPhone = this.phoneNumber.replace(/[\s\-\(\)]/g, '');
    
    // If phone starts with +91, remove it for Indian numbers
    if (normalizedPhone.startsWith('+91')) {
      normalizedPhone = normalizedPhone.substring(3);
    } else if (normalizedPhone.startsWith('91') && normalizedPhone.length === 12) {
      normalizedPhone = normalizedPhone.substring(2);
    }
    
    this.phoneNumber = normalizedPhone;
  }
  
  // Encrypt password using bcrypt
  if (!this.isModified('password')) {
    next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Sign JWT and return
userSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id, userId: this.userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate and hash password token for reset
userSchema.methods.getResetPasswordToken = function () {
  // Generate token
  const resetToken = crypto.randomBytes(20).toString('hex');

  // Hash token and set to resetPasswordToken field
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Set expire
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Create indexes for frequently queried fields
userSchema.index({ userId: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ phoneNumber: 1 }, { unique: true });
userSchema.index({ status: 1 }); // For status-based queries
userSchema.index({ statusUntil: 1 }); // For status expiration queries
userSchema.index({ contacts: 1 }); // For contact-based queries
// Global discovery indexes
userSchema.index({ username: 1 }, { unique: true, sparse: true });
userSchema.index({ searchableName: 1 }); // For name-based searches
userSchema.index({ isPublic: 1 }); // For public profile queries
userSchema.index({ 'appConnections.userId': 1 }); // For app connection queries

const User = mongoose.model('User', userSchema);

module.exports = User;
