const User = require('../models/userModel');
const Friendship = require('../models/Friend');

/**
 * Sync all cached profile images in Friendship model with current User data
 * This fixes stale profile image URLs in the friendships collection
 */
const syncAllProfileImages = async (req, res) => {
  try {
    console.log('🔄 [SYNC] Starting profile image sync...');
    
    // Get all friendships
    const friendships = await Friendship.find({});
    console.log(`📊 [SYNC] Found ${friendships.length} friendships to check`);
    
    let updatedCount = 0;
    let errorCount = 0;
    
    for (const friendship of friendships) {
      try {
        // Get current user data
        const user = await User.findOne({ userId: friendship.userId }).select('profileImage');
        const friend = await User.findOne({ userId: friendship.friendUserId }).select('profileImage');
        
        let needsUpdate = false;
        const updates = {};
        
        // Check if user's cached profile image is stale
        if (user && friendship.userProfileImage !== user.profileImage) {
          updates.userProfileImage = user.profileImage || '';
          needsUpdate = true;
          console.log(`🔄 [SYNC] Updating user ${friendship.userId}: ${friendship.userProfileImage} → ${user.profileImage}`);
        }
        
        // Check if friend's cached profile image is stale
        if (friend && friendship.friendProfileImage !== friend.profileImage) {
          updates.friendProfileImage = friend.profileImage || '';
          needsUpdate = true;
          console.log(`🔄 [SYNC] Updating friend ${friendship.friendUserId}: ${friendship.friendProfileImage} → ${friend.profileImage}`);
        }
        
        // Update if needed
        if (needsUpdate) {
          await Friendship.updateOne({ _id: friendship._id }, { $set: updates });
          updatedCount++;
        }
      } catch (err) {
        console.error(`❌ [SYNC] Error syncing friendship ${friendship._id}:`, err.message);
        errorCount++;
      }
    }
    
    console.log(`✅ [SYNC] Complete! Updated: ${updatedCount}, Errors: ${errorCount}`);
    
    res.json({
      success: true,
      message: 'Profile images synced successfully',
      stats: {
        total: friendships.length,
        updated: updatedCount,
        errors: errorCount
      }
    });
    
  } catch (error) {
    console.error('❌ [SYNC] Error syncing profile images:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync profile images',
      error: error.message
    });
  }
};

/**
 * Get sync status - shows how many friendships have stale profile images
 */
const getSyncStatus = async (req, res) => {
  try {
    const friendships = await Friendship.find({});
    
    let staleCount = 0;
    const staleExamples = [];
    
    for (const friendship of friendships.slice(0, 100)) { // Check first 100
      const user = await User.findOne({ userId: friendship.userId }).select('profileImage');
      const friend = await User.findOne({ userId: friendship.friendUserId }).select('profileImage');
      
      const userStale = user && friendship.userProfileImage !== user.profileImage;
      const friendStale = friend && friendship.friendProfileImage !== friend.profileImage;
      
      if (userStale || friendStale) {
        staleCount++;
        if (staleExamples.length < 5) {
          staleExamples.push({
            userId: friendship.userId,
            friendUserId: friendship.friendUserId,
            userStale,
            friendStale
          });
        }
      }
    }
    
    res.json({
      total: friendships.length,
      checked: Math.min(100, friendships.length),
      staleFound: staleCount,
      examples: staleExamples
    });
    
  } catch (error) {
    console.error('❌ [SYNC] Error checking sync status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check sync status',
      error: error.message
    });
  }
};

module.exports = {
  syncAllProfileImages,
  getSyncStatus
};
