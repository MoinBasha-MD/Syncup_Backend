/**
 * Saved Vibes Routes
 * Handles saving/bookmarking vibes and managing collections
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const SavedVibe = require('../models/SavedVibe');
const Collection = require('../models/Collection');
const FeedPost = require('../models/FeedPost');

// Save a vibe
router.post('/vibes/:vibeId/save', protect, async (req, res) => {
  try {
    const { vibeId } = req.params;
    const { collectionId } = req.body;
    const userId = req.user._id;

    console.log('🔖 [SAVED VIBES] Save request:', { userId, vibeId, collectionId });

    // Check if already saved
    const existing = await SavedVibe.findOne({ userId, vibeId });
    if (existing) {
      return res.json({
        success: true,
        message: 'Vibe already saved',
        alreadySaved: true
      });
    }

    // Create saved vibe
    const savedVibe = new SavedVibe({
      userId,
      vibeId,
      collectionId,
      savedAt: new Date()
    });

    await savedVibe.save();

    // If collectionId provided, add to collection
    if (collectionId) {
      await Collection.findByIdAndUpdate(
        collectionId,
        { $addToSet: { vibeIds: vibeId } }
      );
    }

    console.log('✅ [SAVED VIBES] Vibe saved successfully');

    res.json({
      success: true,
      message: 'Vibe saved successfully'
    });
  } catch (error) {
    console.error('❌ [SAVED VIBES] Error saving vibe:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving vibe',
      error: error.message
    });
  }
});

// Unsave a vibe
router.delete('/vibes/:vibeId/save', protect, async (req, res) => {
  try {
    const { vibeId } = req.params;
    const userId = req.user._id;

    console.log('🔖 [SAVED VIBES] Unsave request:', { userId, vibeId });

    // Remove from saved vibes
    const result = await SavedVibe.deleteOne({ userId, vibeId });

    // Remove from all collections
    await Collection.updateMany(
      { userId },
      { $pull: { vibeIds: vibeId } }
    );

    console.log('✅ [SAVED VIBES] Vibe unsaved successfully');

    res.json({
      success: true,
      message: 'Vibe unsaved successfully',
      removed: result.deletedCount > 0
    });
  } catch (error) {
    console.error('❌ [SAVED VIBES] Error unsaving vibe:', error);
    res.status(500).json({
      success: false,
      message: 'Error unsaving vibe',
      error: error.message
    });
  }
});

// Get all saved vibes
router.get('/vibes/saved', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const { collectionId } = req.query;

    console.log('🔖 [SAVED VIBES] Get saved vibes:', { userId, collectionId });

    // Build query
    const query = { userId };
    if (collectionId) {
      query.collectionId = collectionId;
    }

    // Get saved vibes
    const savedVibes = await SavedVibe.find(query)
      .sort({ savedAt: -1 })
      .populate({
        path: 'vibeId',
        populate: [
          { path: 'userId', select: 'name username profileImage' },
          { path: 'media' }
        ]
      });

    // Filter out deleted vibes
    const vibes = savedVibes
      .filter(sv => sv.vibeId)
      .map(sv => sv.vibeId);

    console.log('✅ [SAVED VIBES] Found', vibes.length, 'saved vibes');

    res.json({
      success: true,
      vibes,
      count: vibes.length
    });
  } catch (error) {
    console.error('❌ [SAVED VIBES] Error getting saved vibes:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting saved vibes',
      error: error.message
    });
  }
});

// Create collection
router.post('/collections/create', protect, async (req, res) => {
  try {
    const { name, description, isPrivate = true } = req.body;
    const userId = req.user._id;

    console.log('📁 [COLLECTIONS] Create collection:', { userId, name });

    // Validate
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Collection name is required'
      });
    }

    // Check if collection with same name exists
    const existing = await Collection.findOne({ userId, name: name.trim() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Collection with this name already exists'
      });
    }

    // Create collection
    const collection = new Collection({
      userId,
      name: name.trim(),
      description: description?.trim(),
      vibeIds: [],
      isPrivate,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await collection.save();

    console.log('✅ [COLLECTIONS] Collection created:', collection._id);

    res.json({
      success: true,
      message: 'Collection created successfully',
      collection
    });
  } catch (error) {
    console.error('❌ [COLLECTIONS] Error creating collection:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating collection',
      error: error.message
    });
  }
});

// Get all collections
router.get('/collections', protect, async (req, res) => {
  try {
    const userId = req.user._id;

    console.log('📁 [COLLECTIONS] Get collections:', { userId });

    const collections = await Collection.find({ userId })
      .sort({ createdAt: -1 });

    // Add vibe count to each collection
    const collectionsWithCount = collections.map(col => ({
      ...col.toObject(),
      vibeCount: col.vibeIds.length
    }));

    console.log('✅ [COLLECTIONS] Found', collections.length, 'collections');

    res.json({
      success: true,
      collections: collectionsWithCount,
      count: collections.length
    });
  } catch (error) {
    console.error('❌ [COLLECTIONS] Error getting collections:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting collections',
      error: error.message
    });
  }
});

// Add vibe to collection
router.post('/collections/:collectionId/add', protect, async (req, res) => {
  try {
    const { collectionId } = req.params;
    const { vibeId } = req.body;
    const userId = req.user._id;

    console.log('📁 [COLLECTIONS] Add vibe to collection:', { userId, collectionId, vibeId });

    // Find collection
    const collection = await Collection.findOne({ _id: collectionId, userId });
    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // Add vibe if not already in collection
    if (!collection.vibeIds.includes(vibeId)) {
      collection.vibeIds.push(vibeId);
      collection.updatedAt = new Date();
      await collection.save();
    }

    // Also ensure vibe is saved
    const savedVibe = await SavedVibe.findOne({ userId, vibeId });
    if (!savedVibe) {
      await new SavedVibe({
        userId,
        vibeId,
        collectionId,
        savedAt: new Date()
      }).save();
    }

    console.log('✅ [COLLECTIONS] Vibe added to collection');

    res.json({
      success: true,
      message: 'Vibe added to collection'
    });
  } catch (error) {
    console.error('❌ [COLLECTIONS] Error adding vibe to collection:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding vibe to collection',
      error: error.message
    });
  }
});

// Remove vibe from collection
router.post('/collections/:collectionId/remove', protect, async (req, res) => {
  try {
    const { collectionId } = req.params;
    const { vibeId } = req.body;
    const userId = req.user._id;

    console.log('📁 [COLLECTIONS] Remove vibe from collection:', { userId, collectionId, vibeId });

    // Find collection
    const collection = await Collection.findOne({ _id: collectionId, userId });
    if (!collection) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    // Remove vibe
    collection.vibeIds = collection.vibeIds.filter(id => id.toString() !== vibeId);
    collection.updatedAt = new Date();
    await collection.save();

    console.log('✅ [COLLECTIONS] Vibe removed from collection');

    res.json({
      success: true,
      message: 'Vibe removed from collection'
    });
  } catch (error) {
    console.error('❌ [COLLECTIONS] Error removing vibe from collection:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing vibe from collection',
      error: error.message
    });
  }
});

// Delete collection
router.delete('/collections/:collectionId', protect, async (req, res) => {
  try {
    const { collectionId } = req.params;
    const userId = req.user._id;

    console.log('📁 [COLLECTIONS] Delete collection:', { userId, collectionId });

    // Delete collection
    const result = await Collection.deleteOne({ _id: collectionId, userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Collection not found'
      });
    }

    console.log('✅ [COLLECTIONS] Collection deleted');

    res.json({
      success: true,
      message: 'Collection deleted successfully'
    });
  } catch (error) {
    console.error('❌ [COLLECTIONS] Error deleting collection:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting collection',
      error: error.message
    });
  }
});

module.exports = router;
