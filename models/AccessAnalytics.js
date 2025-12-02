const mongoose = require('mongoose');

/**
 * AccessAnalytics Model - Detailed tracking of document access
 * Stores every access event for analytics and insights
 */
const accessAnalyticsSchema = new mongoose.Schema(
  {
    // Document owner
    ownerId: {
      type: String,
      required: true,
      index: true
    },
    
    // Document details
    documentId: {
      type: String,
      required: true,
      index: true
    },
    
    documentType: {
      type: String,
      required: true
    },
    
    // Accessor details
    accessorId: {
      type: String,
      required: true,
      index: true
    },
    
    accessorName: {
      type: String,
      required: true
    },
    
    accessorUsername: {
      type: String,
      required: true
    },
    
    accessorProfileImage: {
      type: String,
      default: null
    },
    
    // Access details
    action: {
      type: String,
      enum: ['view', 'download', 'share', 'request'],
      required: true,
      index: true
    },
    
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    },
    
    // Technical details
    ipAddress: {
      type: String,
      default: null
    },
    
    deviceInfo: {
      type: String,
      default: null
    },
    
    userAgent: {
      type: String,
      default: null
    },
    
    // Session info
    sessionId: {
      type: String,
      default: null
    },
    
    duration: {
      type: Number, // in seconds
      default: null
    },
    
    // Metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

// Indexes for efficient queries
accessAnalyticsSchema.index({ ownerId: 1, timestamp: -1 });
accessAnalyticsSchema.index({ documentId: 1, timestamp: -1 });
accessAnalyticsSchema.index({ accessorId: 1, timestamp: -1 });
accessAnalyticsSchema.index({ ownerId: 1, documentId: 1, timestamp: -1 });
accessAnalyticsSchema.index({ action: 1, timestamp: -1 });

// Static method: Get analytics for a document
accessAnalyticsSchema.statics.getDocumentAnalytics = async function(ownerId, documentId) {
  const analytics = await this.aggregate([
    {
      $match: {
        ownerId,
        documentId
      }
    },
    {
      $facet: {
        // Total counts
        totals: [
          {
            $group: {
              _id: '$action',
              count: { $sum: 1 }
            }
          }
        ],
        // Top viewers
        topViewers: [
          {
            $match: { action: { $in: ['view', 'download'] } }
          },
          {
            $group: {
              _id: '$accessorId',
              name: { $first: '$accessorName' },
              username: { $first: '$accessorUsername' },
              profileImage: { $first: '$accessorProfileImage' },
              viewCount: {
                $sum: {
                  $cond: [{ $eq: ['$action', 'view'] }, 1, 0]
                }
              },
              downloadCount: {
                $sum: {
                  $cond: [{ $eq: ['$action', 'download'] }, 1, 0]
                }
              },
              lastAccess: { $max: '$timestamp' }
            }
          },
          {
            $sort: { viewCount: -1, downloadCount: -1 }
          },
          {
            $limit: 10
          }
        ],
        // Recent activity
        recentActivity: [
          {
            $sort: { timestamp: -1 }
          },
          {
            $limit: 20
          },
          {
            $project: {
              accessorId: 1,
              accessorName: 1,
              accessorUsername: 1,
              accessorProfileImage: 1,
              action: 1,
              timestamp: 1
            }
          }
        ],
        // Access by hour (for heatmap)
        hourlyAccess: [
          {
            $group: {
              _id: { $hour: '$timestamp' },
              count: { $sum: 1 }
            }
          },
          {
            $sort: { _id: 1 }
          }
        ],
        // Access by day of week
        dailyAccess: [
          {
            $group: {
              _id: { $dayOfWeek: '$timestamp' },
              count: { $sum: 1 }
            }
          },
          {
            $sort: { _id: 1 }
          }
        ]
      }
    }
  ]);
  
  return analytics[0];
};

// Static method: Get user's access timeline
accessAnalyticsSchema.statics.getUserTimeline = async function(ownerId, limit = 50) {
  return await this.find({ ownerId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('documentId documentType accessorId accessorName accessorUsername accessorProfileImage action timestamp')
    .lean();
};

// Static method: Get access stats for owner
accessAnalyticsSchema.statics.getOwnerStats = async function(ownerId) {
  const stats = await this.aggregate([
    {
      $match: { ownerId }
    },
    {
      $group: {
        _id: null,
        totalViews: {
          $sum: {
            $cond: [{ $eq: ['$action', 'view'] }, 1, 0]
          }
        },
        totalDownloads: {
          $sum: {
            $cond: [{ $eq: ['$action', 'download'] }, 1, 0]
          }
        },
        totalShares: {
          $sum: {
            $cond: [{ $eq: ['$action', 'share'] }, 1, 0]
          }
        },
        uniqueAccessors: { $addToSet: '$accessorId' },
        lastAccess: { $max: '$timestamp' }
      }
    },
    {
      $project: {
        _id: 0,
        totalViews: 1,
        totalDownloads: 1,
        totalShares: 1,
        uniqueAccessors: { $size: '$uniqueAccessors' },
        lastAccess: 1
      }
    }
  ]);
  
  return stats[0] || {
    totalViews: 0,
    totalDownloads: 0,
    totalShares: 0,
    uniqueAccessors: 0,
    lastAccess: null
  };
};

module.exports = mongoose.model('AccessAnalytics', accessAnalyticsSchema);
