const User = require('../models/userModel');

/**
 * Get nearby friends' locations
 * Returns friends within specified radius with their current locations
 */
exports.getNearbyFriends = async (req, res) => {
  try {
    const userId = req.user._id;
    const { radius = 50 } = req.query; // Default 50km radius

    // Get current user with friends list
    const user = await User.findById(userId).select('friends currentLocation');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.currentLocation || !user.currentLocation.latitude || !user.currentLocation.longitude) {
      return res.status(400).json({ message: 'User location not available' });
    }

    const userLat = user.currentLocation.latitude;
    const userLng = user.currentLocation.longitude;

    // Get friends with their current locations
    const friends = await User.find({
      _id: { $in: user.friends },
      'currentLocation.latitude': { $exists: true },
      'currentLocation.longitude': { $exists: true }
    }).select('name profileImage currentLocation lastSeen');

    // Calculate distance and filter by radius
    const nearbyFriends = friends
      .map(friend => {
        const friendLat = friend.currentLocation.latitude;
        const friendLng = friend.currentLocation.longitude;
        
        // Calculate distance using Haversine formula
        const distance = calculateDistance(userLat, userLng, friendLat, friendLng);
        
        // Check if online (last seen within 5 minutes)
        const isOnline = friend.lastSeen && 
          (Date.now() - new Date(friend.lastSeen).getTime()) < 5 * 60 * 1000;

        return {
          userId: friend._id,
          name: friend.name,
          profileImage: friend.profileImage,
          location: {
            latitude: friendLat,
            longitude: friendLng,
            timestamp: friend.currentLocation.timestamp,
            lastUpdated: friend.currentLocation.lastUpdated
          },
          distance: Math.round(distance * 10) / 10, // Round to 1 decimal
          isOnline,
          lastSeen: friend.lastSeen
        };
      })
      .filter(friend => friend.distance <= parseFloat(radius))
      .sort((a, b) => a.distance - b.distance); // Sort by distance

    console.log(`✅ [LOCATION] Found ${nearbyFriends.length} nearby friends for user ${userId}`);

    res.json({
      success: true,
      count: nearbyFriends.length,
      radius: parseFloat(radius),
      friends: nearbyFriends
    });

  } catch (error) {
    console.error('❌ [LOCATION] Error getting nearby friends:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error getting nearby friends',
      error: error.message 
    });
  }
};

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Get specific friend's location
 */
exports.getFriendLocation = async (req, res) => {
  try {
    const userId = req.user._id;
    const { friendId } = req.params;

    // Verify friendship
    const user = await User.findById(userId).select('friends');
    if (!user.friends.includes(friendId)) {
      return res.status(403).json({ message: 'Not friends with this user' });
    }

    // Get friend's location
    const friend = await User.findById(friendId).select('name profileImage currentLocation lastSeen');
    
    if (!friend) {
      return res.status(404).json({ message: 'Friend not found' });
    }

    if (!friend.currentLocation || !friend.currentLocation.latitude) {
      return res.status(404).json({ message: 'Friend location not available' });
    }

    const isOnline = friend.lastSeen && 
      (Date.now() - new Date(friend.lastSeen).getTime()) < 5 * 60 * 1000;

    res.json({
      success: true,
      friend: {
        userId: friend._id,
        name: friend.name,
        profileImage: friend.profileImage,
        location: friend.currentLocation,
        isOnline,
        lastSeen: friend.lastSeen
      }
    });

  } catch (error) {
    console.error('❌ [LOCATION] Error getting friend location:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error getting friend location',
      error: error.message 
    });
  }
};
