const mongoose = require('mongoose');

/**
 * DocSpace Model - User document storage with access control
 * Each user can store up to 3 documents and manage access permissions
 */
const docSpaceSchema = new mongoose.Schema(
  {
    // Owner of this doc space
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    
    // Documents stored (max 3)
    documents: [{
      documentId: {
        type: String,
        required: true,
        default: () => `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      },
      
      // Predefined document type
      documentType: {
        type: String,
        required: true,
        enum: [
          'PAN Card',
          'Aadhar Card',
          'Voter ID Card',
          'Passport',
          'Driving License',
          'Birth Certificate',
          '10th Marksheet',
          '12th Marksheet',
          'Degree Certificate',
          'Ration Card',
          'Bank Passbook',
          'Other'
        ]
      },
      
      // Custom name if type is "Other"
      customName: {
        type: String,
        maxlength: 100,
        default: ''
      },
      
      // File storage
      fileUrl: {
        type: String,
        required: true
      },
      
      fileType: {
        type: String, // "application/pdf", "image/jpeg", etc.
        required: true
      },
      
      fileSize: {
        type: Number, // in bytes
        required: true
      },
      
      uploadedAt: {
        type: Date,
        default: Date.now
      },
      
      // Enhanced Access Control
      accessControl: {
        enabled: {
          type: Boolean,
          default: false
        },
        expiryDate: {
          type: Date,
          default: null
        },
        viewLimit: {
          type: Number,
          default: null // null = unlimited
        },
        viewCount: {
          type: Number,
          default: 0
        },
        downloadLimit: {
          type: Number,
          default: null // null = unlimited
        },
        downloadCount: {
          type: Number,
          default: 0
        },
        autoRevoke: {
          type: Boolean,
          default: false
        }
      },
      
      // Document Category & Tags
      category: {
        type: String,
        enum: ['Identity', 'Financial', 'Medical', 'Education', 'Personal', 'Work', 'Other'],
        default: 'Other'
      },
      
      tags: [{
        type: String,
        maxlength: 30
      }],
      
      isFavorite: {
        type: Boolean,
        default: false
      },
      
      // Track who accessed this document
      accessLog: [{
        userId: {
          type: String,
          required: true
        },
        userName: {
          type: String,
          required: true
        },
        accessedAt: {
          type: Date,
          default: Date.now
        },
        accessType: {
          type: String,
          enum: ['view', 'download', 'share'],
          default: 'view'
        },
        ipAddress: {
          type: String,
          default: null
        },
        deviceInfo: {
          type: String,
          default: null
        }
      }]
    }],
    
    // Users with access to ALL documents
    generalAccessList: [{
      userId: {
        type: String,
        required: true
      },
      userName: {
        type: String,
        required: true
      },
      grantedAt: {
        type: Date,
        default: Date.now
      },
      grantedBy: {
        type: String, // userId who granted access
        default: null
      }
    }],
    
    // Document-specific access (per-document permissions)
    documentSpecificAccess: [{
      documentId: {
        type: String,
        required: true
      },
      userId: {
        type: String,
        required: true
      },
      userName: {
        type: String,
        required: true
      },
      grantedAt: {
        type: Date,
        default: Date.now
      },
      // Permission Level
      permissionType: {
        type: String,
        enum: ['view', 'download', 'share'],
        default: 'download'
      },
      // Access Duration
      accessType: {
        type: String,
        enum: ['one-time', 'limited', 'permanent'],
        default: 'permanent'
      },
      expiryDate: {
        type: Date,
        default: null
      },
      viewLimit: {
        type: Number,
        default: null // null = unlimited
      },
      viewCount: {
        type: Number,
        default: 0
      },
      usedAt: {
        type: Date, // For one-time access tracking
        default: null
      },
      isRevoked: {
        type: Boolean,
        default: false
      },
      revokedAt: {
        type: Date,
        default: null
      }
    }],
    
    // Settings
    settings: {
      maxDocuments: {
        type: Number,
        default: 3,
        min: 1,
        max: 10
      },
      allowRequests: {
        type: Boolean,
        default: true // Allow others to request documents
      },
      autoApprove: {
        type: Boolean,
        default: false // Auto-approve requests from friends
      },
      notifyOnAccess: {
        type: Boolean,
        default: true // Notify when someone accesses a document
      },
      notifyOnRequest: {
        type: Boolean,
        default: true // Notify when someone requests access
      }
    },
    
    // Statistics
    stats: {
      totalDocuments: {
        type: Number,
        default: 0
      },
      totalAccessGrants: {
        type: Number,
        default: 0
      },
      totalAccesses: {
        type: Number,
        default: 0
      },
      lastAccessedAt: {
        type: Date,
        default: null
      }
    }
  },
  {
    timestamps: true
  }
);

// Indexes
docSpaceSchema.index({ userId: 1 }, { unique: true });
docSpaceSchema.index({ 'documents.documentId': 1 });
docSpaceSchema.index({ 'generalAccessList.userId': 1 });
docSpaceSchema.index({ 'documentSpecificAccess.userId': 1 });
docSpaceSchema.index({ 'documentSpecificAccess.documentId': 1 });

// Validation: Max 3 documents
docSpaceSchema.pre('save', function(next) {
  if (this.documents.length > this.settings.maxDocuments) {
    return next(new Error(`Maximum ${this.settings.maxDocuments} documents allowed`));
  }
  
  // Update stats
  this.stats.totalDocuments = this.documents.length;
  this.stats.totalAccessGrants = this.generalAccessList.length + this.documentSpecificAccess.length;
  
  next();
});

// Static method: Get or create doc space for user
docSpaceSchema.statics.getOrCreate = async function(userId) {
  let docSpace = await this.findOne({ userId });
  
  if (!docSpace) {
    docSpace = await this.create({ userId });
  }
  
  return docSpace;
};

// Static method: Check if user has access to a document
docSpaceSchema.statics.hasAccess = async function(ownerId, requesterId, documentId = null) {
  const docSpace = await this.findOne({ userId: ownerId });
  
  if (!docSpace) {
    return { hasAccess: false, accessType: null };
  }
  
  // Check general access list (access to all documents)
  const hasGeneralAccess = docSpace.generalAccessList.some(
    access => access.userId === requesterId
  );
  
  if (hasGeneralAccess) {
    return { hasAccess: true, accessType: 'general' };
  }
  
  // Check document-specific access
  if (documentId) {
    const specificAccess = docSpace.documentSpecificAccess.find(
      access => access.documentId === documentId && access.userId === requesterId
    );
    
    if (specificAccess) {
      // Check if revoked
      if (specificAccess.isRevoked) {
        return { hasAccess: false, accessType: null, reason: 'Access revoked' };
      }
      
      // Check if expired
      if (specificAccess.expiryDate && new Date() > new Date(specificAccess.expiryDate)) {
        return { hasAccess: false, accessType: null, reason: 'Access expired' };
      }
      
      // Check if one-time access was already used
      if (specificAccess.accessType === 'one-time' && specificAccess.usedAt) {
        return { hasAccess: false, accessType: null, reason: 'One-time access already used' };
      }
      
      // Check view limit
      if (specificAccess.viewLimit && specificAccess.viewCount >= specificAccess.viewLimit) {
        return { hasAccess: false, accessType: null, reason: 'View limit reached' };
      }
      
      return { hasAccess: true, accessType: 'document-specific', accessDetails: specificAccess };
    }
  }
  
  return { hasAccess: false, accessType: null };
};

// Instance method: Add document
docSpaceSchema.methods.addDocument = async function(documentData) {
  if (this.documents.length >= this.settings.maxDocuments) {
    throw new Error(`Maximum ${this.settings.maxDocuments} documents allowed`);
  }
  
  this.documents.push(documentData);
  return await this.save();
};

// Instance method: Remove document
docSpaceSchema.methods.removeDocument = async function(documentId) {
  this.documents = this.documents.filter(doc => doc.documentId !== documentId);
  
  // Also remove document-specific access for this document
  this.documentSpecificAccess = this.documentSpecificAccess.filter(
    access => access.documentId !== documentId
  );
  
  return await this.save();
};

// Instance method: Grant general access
docSpaceSchema.methods.grantGeneralAccess = async function(userId, userName, grantedBy) {
  // Check if already has access
  const hasAccess = this.generalAccessList.some(access => access.userId === userId);
  
  if (!hasAccess) {
    this.generalAccessList.push({
      userId,
      userName,
      grantedAt: new Date(),
      grantedBy
    });
    
    return await this.save();
  }
  
  return this;
};

// Instance method: Revoke general access
docSpaceSchema.methods.revokeGeneralAccess = async function(userId) {
  this.generalAccessList = this.generalAccessList.filter(
    access => access.userId !== userId
  );
  
  return await this.save();
};

// Instance method: Grant document-specific access
docSpaceSchema.methods.grantDocumentAccess = async function(documentId, userId, userName, accessType = 'permanent') {
  // Check if document exists
  const document = this.documents.find(doc => doc.documentId === documentId);
  if (!document) {
    throw new Error('Document not found');
  }
  
  // Check if already has access
  const hasAccess = this.documentSpecificAccess.some(
    access => access.documentId === documentId && access.userId === userId
  );
  
  if (!hasAccess) {
    this.documentSpecificAccess.push({
      documentId,
      userId,
      userName,
      grantedAt: new Date(),
      accessType,
      usedAt: null
    });
    
    return await this.save();
  }
  
  return this;
};

// Instance method: Revoke document-specific access
docSpaceSchema.methods.revokeDocumentAccess = async function(documentId, userId) {
  this.documentSpecificAccess = this.documentSpecificAccess.filter(
    access => !(access.documentId === documentId && access.userId === userId)
  );
  
  return await this.save();
};

// Instance method: Log document access
docSpaceSchema.methods.logAccess = async function(documentId, userId, userName, accessType = 'view') {
  const document = this.documents.find(doc => doc.documentId === documentId);
  
  if (document) {
    document.accessLog.push({
      userId,
      userName,
      accessedAt: new Date(),
      accessType
    });
    
    this.stats.totalAccesses += 1;
    this.stats.lastAccessedAt = new Date();
    
    // Mark one-time access as used
    const specificAccess = this.documentSpecificAccess.find(
      access => access.documentId === documentId && access.userId === userId
    );
    
    if (specificAccess && specificAccess.accessType === 'one-time' && !specificAccess.usedAt) {
      specificAccess.usedAt = new Date();
    }
    
    return await this.save();
  }
  
  return this;
};

// Instance method: Get document by type
docSpaceSchema.methods.getDocumentByType = function(documentType) {
  return this.documents.find(
    doc => doc.documentType.toLowerCase() === documentType.toLowerCase()
  );
};

// Instance method: Get access list for a document
docSpaceSchema.methods.getDocumentAccessList = function(documentId) {
  const specificAccess = this.documentSpecificAccess.filter(
    access => access.documentId === documentId
  );
  
  return {
    generalAccess: this.generalAccessList,
    specificAccess
  };
};

const DocSpace = mongoose.model('DocSpace', docSpaceSchema);

module.exports = DocSpace;
