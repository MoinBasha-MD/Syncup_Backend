const DocSpace = require('../models/DocSpace');

/**
 * Search documents
 * GET /api/doc-space/search
 */
exports.searchDocuments = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { 
      query, 
      category, 
      tags, 
      dateFrom, 
      dateTo, 
      minSize, 
      maxSize,
      isFavorite,
      sortBy = 'uploadedAt',
      sortOrder = 'desc'
    } = req.query;
    
    const docSpace = await DocSpace.findOne({ userId });
    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Doc space not found'
      });
    }
    
    let documents = [...docSpace.documents];
    
    // Text search
    if (query) {
      const searchLower = query.toLowerCase();
      documents = documents.filter(doc => 
        doc.documentType.toLowerCase().includes(searchLower) ||
        (doc.customName && doc.customName.toLowerCase().includes(searchLower)) ||
        (doc.tags && doc.tags.some(tag => tag.toLowerCase().includes(searchLower)))
      );
    }
    
    // Category filter
    if (category) {
      documents = documents.filter(doc => doc.category === category);
    }
    
    // Tags filter
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      documents = documents.filter(doc => 
        doc.tags && doc.tags.some(tag => tagArray.includes(tag))
      );
    }
    
    // Date range filter
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      documents = documents.filter(doc => new Date(doc.uploadedAt) >= fromDate);
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      documents = documents.filter(doc => new Date(doc.uploadedAt) <= toDate);
    }
    
    // File size filter
    if (minSize) {
      documents = documents.filter(doc => doc.fileSize >= parseInt(minSize));
    }
    if (maxSize) {
      documents = documents.filter(doc => doc.fileSize <= parseInt(maxSize));
    }
    
    // Favorite filter
    if (isFavorite === 'true') {
      documents = documents.filter(doc => doc.isFavorite);
    }
    
    // Sort
    documents.sort((a, b) => {
      let aVal, bVal;
      
      switch (sortBy) {
        case 'name':
          aVal = a.customName || a.documentType;
          bVal = b.customName || b.documentType;
          break;
        case 'size':
          aVal = a.fileSize;
          bVal = b.fileSize;
          break;
        case 'uploadedAt':
        default:
          aVal = new Date(a.uploadedAt);
          bVal = new Date(b.uploadedAt);
      }
      
      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
    
    res.json({
      success: true,
      query: {
        query,
        category,
        tags,
        dateFrom,
        dateTo,
        minSize,
        maxSize,
        isFavorite,
        sortBy,
        sortOrder
      },
      count: documents.length,
      documents
    });
  } catch (error) {
    console.error('❌ [SEARCH] Error searching documents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search documents',
      error: error.message
    });
  }
};

/**
 * Get smart collections
 * GET /api/doc-space/collections
 */
exports.getSmartCollections = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const docSpace = await DocSpace.findOne({ userId });
    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Doc space not found'
      });
    }
    
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    const collections = {
      recentlyUploaded: docSpace.documents
        .filter(doc => new Date(doc.uploadedAt) >= sevenDaysAgo)
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)),
      
      expiringSoon: docSpace.documents
        .filter(doc => 
          doc.accessControl.enabled && 
          doc.accessControl.expiryDate &&
          new Date(doc.accessControl.expiryDate) <= thirtyDaysFromNow &&
          new Date(doc.accessControl.expiryDate) > now
        )
        .sort((a, b) => new Date(a.accessControl.expiryDate) - new Date(b.accessControl.expiryDate)),
      
      mostAccessed: docSpace.documents
        .filter(doc => doc.accessLog.length > 0)
        .sort((a, b) => b.accessLog.length - a.accessLog.length)
        .slice(0, 10),
      
      favorites: docSpace.documents
        .filter(doc => doc.isFavorite)
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)),
      
      largeFiles: docSpace.documents
        .filter(doc => doc.fileSize > 1024 * 1024) // > 1MB
        .sort((a, b) => b.fileSize - a.fileSize)
        .slice(0, 10),
      
      withAccessControl: docSpace.documents
        .filter(doc => doc.accessControl.enabled)
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    };
    
    res.json({
      success: true,
      collections: {
        recentlyUploaded: {
          name: 'Recently Uploaded',
          icon: '🆕',
          count: collections.recentlyUploaded.length,
          documents: collections.recentlyUploaded
        },
        expiringSoon: {
          name: 'Expiring Soon',
          icon: '⏰',
          count: collections.expiringSoon.length,
          documents: collections.expiringSoon
        },
        mostAccessed: {
          name: 'Most Accessed',
          icon: '🔥',
          count: collections.mostAccessed.length,
          documents: collections.mostAccessed
        },
        favorites: {
          name: 'Favorites',
          icon: '⭐',
          count: collections.favorites.length,
          documents: collections.favorites
        },
        largeFiles: {
          name: 'Large Files',
          icon: '📦',
          count: collections.largeFiles.length,
          documents: collections.largeFiles
        },
        withAccessControl: {
          name: 'Access Controlled',
          icon: '🔒',
          count: collections.withAccessControl.length,
          documents: collections.withAccessControl
        }
      }
    });
  } catch (error) {
    console.error('❌ [COLLECTIONS] Error getting collections:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get collections',
      error: error.message
    });
  }
};

/**
 * Get filter options
 * GET /api/doc-space/filters
 */
exports.getFilterOptions = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const docSpace = await DocSpace.findOne({ userId });
    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Doc space not found'
      });
    }
    
    // Get unique categories
    const categories = [...new Set(docSpace.documents.map(doc => doc.category))];
    
    // Get all tags
    const allTags = docSpace.documents.reduce((tags, doc) => {
      if (doc.tags) {
        tags.push(...doc.tags);
      }
      return tags;
    }, []);
    const uniqueTags = [...new Set(allTags)];
    
    // Get date range
    const dates = docSpace.documents.map(doc => new Date(doc.uploadedAt));
    const minDate = dates.length > 0 ? new Date(Math.min(...dates)) : null;
    const maxDate = dates.length > 0 ? new Date(Math.max(...dates)) : null;
    
    // Get size range
    const sizes = docSpace.documents.map(doc => doc.fileSize);
    const minSize = sizes.length > 0 ? Math.min(...sizes) : 0;
    const maxSize = sizes.length > 0 ? Math.max(...sizes) : 0;
    
    res.json({
      success: true,
      filters: {
        categories,
        tags: uniqueTags,
        dateRange: {
          min: minDate,
          max: maxDate
        },
        sizeRange: {
          min: minSize,
          max: maxSize
        },
        documentTypes: [...new Set(docSpace.documents.map(doc => doc.documentType))]
      }
    });
  } catch (error) {
    console.error('❌ [FILTERS] Error getting filter options:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get filter options',
      error: error.message
    });
  }
};

module.exports = exports;
