const User = require('../models/userModel');

/**
 * Get nearby friends' locations
 * Returns friends within specified radius with their current locations
 * IMPORTANT: This supports ASYMMETRIC sharing - you can see friends who are sharing with you,
 * even if you're not sharing with them
 */
exports.getNearbyFriends = async (req, res) => {
  try {
    const userId = req.user._id;
    const { radius = 50 } = req.query; // Default 50km radius
    const LocationSettings = require('../models/LocationSettings');

    // Get current user
    const user = await User.findById(userId).select('friends currentLocation');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // User location is optional - they can view others without sharing their own
    let userLat = null;
    let userLng = null;
    
    if (user.currentLocation && user.currentLocation.latitude && user.currentLocation.longitude) {
      userLat = user.currentLocation.latitude;
      userLng = user.currentLocation.longitude;
    }

    // Get all friends
    const friends = await User.find({
      _id: { $in: user.friends }
    }).select('name profileImage currentLocation lastSeen');

    const nearbyFriends = [];

    // Check each friend to see if they're sharing with current user
    for (const friend of friends) {
      // Check if friend has location data
      if (!friend.currentLocation || !friend.currentLocation.latitude || !friend.currentLocation.longitude) {
        continue;
      }

      // Check if friend is sharing their location with current user
      const friendSettings = await LocationSettings.findOne({ userId: friend._id });
      
      // If no settings, skip (not sharing)
      if (!friendSettings) {
        continue;
      }

      // Check if friend is sharing with current user (asymmetric check)
      const isSharingWithMe = friendSettings.isSharingWith(userId);
      
      if (!isSharingWithMe) {
        continue; // Friend is not sharing with me
      }

      const friendLat = friend.currentLocation.latitude;
      const friendLng = friend.currentLocation.longitude;
      
      // Calculate distance if user has location
      let distance = null;
      if (userLat && userLng) {
        distance = calculateDistance(userLat, userLng, friendLat, friendLng);
        distance = Math.round(distance * 10) / 10; // Round to 1 decimal
        
        // Filter by radius if user has location
        if (distance > parseFloat(radius)) {
          continue;
        }
      }
      
      // Check if online (last seen within 5 minutes)
      const isOnline = friend.lastSeen && 
        (Date.now() - new Date(friend.lastSeen).getTime()) < 5 * 60 * 1000;

      nearbyFriends.push({
        userId: friend._id,
        name: friend.name,
        profileImage: friend.profileImage,
        location: {
          latitude: friendLat,
          longitude: friendLng,
          timestamp: friend.currentLocation.timestamp,
          lastUpdated: friend.currentLocation.lastUpdated
        },
        distance: distance, // null if user has no location
        isOnline,
        lastSeen: friend.lastSeen,
        isSharingWithMe: true // They are sharing with me
      });
    }

    // Sort by distance if available, otherwise by name
    nearbyFriends.sort((a, b) => {
      if (a.distance !== null && b.distance !== null) {
        return a.distance - b.distance;
      }
      return a.name.localeCompare(b.name);
    });

    console.log(`✅ [LOCATION] Found ${nearbyFriends.length} friends sharing location with user ${userId}`);

    res.json({
      success: true,
      count: nearbyFriends.length,
      radius: parseFloat(radius),
      friends: nearbyFriends,
      userHasLocation: userLat !== null && userLng !== null
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
