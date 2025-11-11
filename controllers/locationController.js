const User = require('../models/userModel');
const Friend = require('../models/Friend');

/**
 * Get nearby friends' locations
 * Returns friends within specified radius with their current locations
 * IMPORTANT: This supports ASYMMETRIC sharing - you can see friends who are sharing with you,
 * even if you're not sharing with them
 */
exports.getNearbyFriends = async (req, res) => {
  try {
    const userObjectId = req.user._id; // MongoDB ObjectId
    const userIdString = req.user.userId; // UUID string
    const { radius = 50 } = req.query; // Default 50km radius
    const LocationSettings = require('../models/LocationSettings');

    console.log('🔍 [LOCATION] Fetching nearby friends for user:', userIdString);
    console.log('🔍 [LOCATION] User ObjectId:', userObjectId);

    // Get current user
    const user = await User.findById(userObjectId).select('userId currentLocation');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // User location is optional - they can view others without sharing their own
    let userLat = null;
    let userLng = null;
    
    if (user.currentLocation && user.currentLocation.latitude && user.currentLocation.longitude) {
      userLat = user.currentLocation.latitude;
      userLng = user.currentLocation.longitude;
      console.log('📍 [LOCATION] User location:', { lat: userLat, lng: userLng });
    } else {
      console.log('⚠️ [LOCATION] User has no location data');
    }

    // DEBUG: Check if Friend model has any data
    const totalFriends = await Friend.countDocuments({ userId: userIdString });
    console.log(`🔍 [LOCATION] Total friendships for this user in DB: ${totalFriends}`);
    
    // DEBUG: Check all friendships regardless of status
    const allUserFriendships = await Friend.find({ userId: userIdString }).limit(5);
    console.log(`🔍 [LOCATION] Sample friendships:`, allUserFriendships.map(f => ({
      friendUserId: f.friendUserId,
      status: f.status,
      isDeleted: f.isDeleted
    })));

    // Get all accepted friends using Friend model
    const friendships = await Friend.getFriends(userIdString, {
      status: 'accepted',
      limit: 1000
    });

    console.log(`👥 [LOCATION] Found ${friendships.length} accepted friends`);

    if (friendships.length === 0) {
      return res.json({
        success: true,
        count: 0,
        radius: parseFloat(radius),
        friends: [],
        userHasLocation: userLat !== null && userLng !== null
      });
    }

    // Get friend user IDs
    const friendUserIds = friendships.map(f => f.friendUserId);

    // Get friend user data with locations
    const friendUsers = await User.find({
      userId: { $in: friendUserIds },
      'currentLocation.latitude': { $exists: true, $ne: null },
      'currentLocation.longitude': { $exists: true, $ne: null }
    }).select('userId name profileImage currentLocation lastSeen');

    console.log(`📍 [LOCATION] Found ${friendUsers.length} friends with location data`);

    const nearbyFriends = [];

    // Check each friend to see if they're sharing with current user
    for (const friendUser of friendUsers) {
      const friendLat = friendUser.currentLocation.latitude;
      const friendLng = friendUser.currentLocation.longitude;

      // Get friend's MongoDB ObjectId for LocationSettings query
      const friendObjectId = friendUser._id;

      // Check if friend is sharing their location with current user
      const friendSettings = await LocationSettings.findOne({ userId: friendObjectId });
      
      // If no settings, skip (not sharing)
      if (!friendSettings) {
        console.log(`⚠️ [LOCATION] ${friendUser.name} has no location settings`);
        continue;
      }

      // Check if friend is sharing with current user (asymmetric check)
      const isSharingWithMe = friendSettings.isSharingWith(userObjectId);
      
      if (!isSharingWithMe) {
        console.log(`⚠️ [LOCATION] ${friendUser.name} is not sharing location`);
        continue; // Friend is not sharing with me
      }
      
      // Calculate distance if user has location
      let distance = null;
      if (userLat && userLng) {
        distance = calculateDistance(userLat, userLng, friendLat, friendLng);
        distance = Math.round(distance * 10) / 10; // Round to 1 decimal
        
        // Filter by radius if user has location (Snapchat-style)
        if (distance > parseFloat(radius)) {
          console.log(`📏 [LOCATION] ${friendUser.name} is ${distance}km away (outside ${radius}km radius)`);
          continue;
        }
      }
      
      // Check if online (last seen within 5 minutes)
      const isOnline = friendUser.lastSeen && 
        (Date.now() - new Date(friendUser.lastSeen).getTime()) < 5 * 60 * 1000;

      nearbyFriends.push({
        userId: friendUser.userId, // Return UUID string for frontend
        name: friendUser.name,
        profileImage: friendUser.profileImage,
        location: {
          latitude: friendLat,
          longitude: friendLng,
          timestamp: friendUser.currentLocation.timestamp,
          lastUpdated: friendUser.currentLocation.lastUpdated
        },
        distance: distance, // null if user has no location
        isOnline,
        lastSeen: friendUser.lastSeen,
        isSharingWithMe: true // They are sharing with me
      });

      console.log(`✅ [LOCATION] Added ${friendUser.name} - ${distance ? distance + 'km' : 'distance unknown'}`);
    }

    // Sort by distance if available, otherwise by name (Snapchat-style)
    nearbyFriends.sort((a, b) => {
      if (a.distance !== null && b.distance !== null) {
        return a.distance - b.distance;
      }
      return a.name.localeCompare(b.name);
    });

    console.log(`✅ [LOCATION] Returning ${nearbyFriends.length} nearby friends`);

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
 * Get ALL friends' locations with distances (not limited by radius)
 * Returns all friends who are sharing their location, sorted by distance
 */
exports.getAllFriendsLocations = async (req, res) => {
  try {
    const userObjectId = req.user._id; // MongoDB ObjectId
    const userIdString = req.user.userId; // UUID string
    const LocationSettings = require('../models/LocationSettings');

    console.log('🔍 [LOCATION] Fetching ALL friends locations for user:', userIdString);

    // Get current user
    const user = await User.findById(userObjectId).select('userId currentLocation');
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // User location is optional
    let userLat = null;
    let userLng = null;
    
    if (user.currentLocation && user.currentLocation.latitude && user.currentLocation.longitude) {
      userLat = user.currentLocation.latitude;
      userLng = user.currentLocation.longitude;
      console.log('📍 [LOCATION] User location:', { lat: userLat, lng: userLng });
    }

    // Get all accepted friends using Friend model
    const friendships = await Friend.getFriends(userIdString, {
      status: 'accepted',
      limit: 1000
    });

    console.log(`👥 [LOCATION] Found ${friendships.length} accepted friends`);

    if (friendships.length === 0) {
      return res.json({
        success: true,
        count: 0,
        friends: [],
        userHasLocation: userLat !== null && userLng !== null
      });
    }

    // Get friend user IDs
    const friendUserIds = friendships.map(f => f.friendUserId);

    // Get friend user data with locations
    const friendUsers = await User.find({
      userId: { $in: friendUserIds },
      'currentLocation.latitude': { $exists: true, $ne: null },
      'currentLocation.longitude': { $exists: true, $ne: null }
    }).select('userId name profileImage currentLocation lastSeen');

    console.log(`📍 [LOCATION] Found ${friendUsers.length} friends with location data`);

    const allFriendsWithLocations = [];

    // Check each friend to see if they're sharing with current user
    for (const friendUser of friendUsers) {
      const friendLat = friendUser.currentLocation.latitude;
      const friendLng = friendUser.currentLocation.longitude;

      // Get friend's MongoDB ObjectId for LocationSettings query
      const friendObjectId = friendUser._id;

      // Check if friend is sharing their location with current user
      const friendSettings = await LocationSettings.findOne({ userId: friendObjectId });
      
      if (!friendSettings) {
        continue;
      }

      const isSharingWithMe = friendSettings.isSharingWith(userObjectId);
      
      if (!isSharingWithMe) {
        continue;
      }
      
      // Calculate distance if user has location
      let distance = null;
      let distanceFormatted = 'Unknown';
      
      if (userLat && userLng) {
        distance = calculateDistance(userLat, userLng, friendLat, friendLng);
        distance = Math.round(distance * 10) / 10; // Round to 1 decimal
        
        // Format distance
        if (distance < 1) {
          distanceFormatted = `${Math.round(distance * 1000)}m`;
        } else if (distance < 10) {
          distanceFormatted = `${distance.toFixed(1)}km`;
        } else {
          distanceFormatted = `${Math.round(distance)}km`;
        }
      }
      
      // Check if online
      const isOnline = friendUser.lastSeen && 
        (Date.now() - new Date(friendUser.lastSeen).getTime()) < 5 * 60 * 1000;

      allFriendsWithLocations.push({
        userId: friendUser.userId, // Return UUID string for frontend
        name: friendUser.name,
        profileImage: friendUser.profileImage,
        location: {
          latitude: friendLat,
          longitude: friendLng,
          timestamp: friendUser.currentLocation.timestamp,
          lastUpdated: friendUser.currentLocation.lastUpdated
        },
        distance: distance,
        distanceFormatted: distanceFormatted,
        isOnline,
        lastSeen: friendUser.lastSeen,
        isSharingWithMe: true
      });
    }

    // Sort by distance (closest first), then by name
    allFriendsWithLocations.sort((a, b) => {
      if (a.distance !== null && b.distance !== null) {
        return a.distance - b.distance;
      }
      if (a.distance === null && b.distance !== null) return 1;
      if (a.distance !== null && b.distance === null) return -1;
      return a.name.localeCompare(b.name);
    });

    console.log(`✅ [LOCATION] Returning ${allFriendsWithLocations.length} friends with locations`);

    res.json({
      success: true,
      count: allFriendsWithLocations.length,
      friends: allFriendsWithLocations,
      userHasLocation: userLat !== null && userLng !== null
    });

  } catch (error) {
    console.error('❌ [LOCATION] Error getting all friends locations:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error getting all friends locations',
      error: error.message 
    });
  }
};

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
