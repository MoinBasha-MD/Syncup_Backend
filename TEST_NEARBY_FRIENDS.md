# Test Nearby Friends - Quick Guide

## What We Just Added

Enhanced logging to see exactly why no friends are showing:

```javascript
// New debug logs in locationController.js:
🔍 [LOCATION] Total friendships for this user in DB: X
🔍 [LOCATION] Sample friendships: [...]
```

## Next Steps

### 1. Restart Backend (if needed)
The backend should auto-reload with nodemon, but if not:
```bash
cd e:\Backend
# Stop current process (Ctrl+C)
npm start
```

### 2. Test the App Again
1. Open the Syncup app
2. Go to Map Tab
3. Check the backend console logs

### 3. Look for These New Logs

**Backend Console:**
```
🔍 [LOCATION] Fetching nearby friends for user: 38283786-efcf-45bf-9f8b-42c312285 7b5
🔍 [LOCATION] User ObjectId: 683858aa6095e8538dbad331
📍 [LOCATION] User location: { lat: X, lng: Y }
🔍 [LOCATION] Total friendships for this user in DB: 0  ← THIS IS KEY!
🔍 [LOCATION] Sample friendships: []
👥 [LOCATION] Found 0 accepted friends
```

## Diagnosis

### If "Total friendships = 0":
**Problem**: You have NO friends in the database
**Solution**: You need to add friends first

### If "Total friendships > 0" but "Sample friendships = []":
**Problem**: Database query issue
**Solution**: Check userId format

### If "Sample friendships" shows data but "Found 0 accepted friends":
**Problem**: Friends exist but status is not 'accepted'
**Solution**: Check friend status field

## How to Add Test Friends

### Option 1: Use the App
1. Go to Contacts Tab
2. Add a friend
3. Wait for them to accept

### Option 2: Manual Database Insert

**Step 1: Get your userId**
From backend logs, you see:
```
userId: '38283786-efcf-45bf-9f8b-42c312285 7b5'
```

**Step 2: Create a test friend user**
```javascript
// In MongoDB shell or Compass:
db.users.insertOne({
  userId: "test-friend-uuid-123",
  name: "Test Friend",
  phoneNumber: "+1234567890",
  password: "hashed_password_here",
  currentLocation: {
    latitude: 12.9716,  // Bangalore coordinates (change to near you)
    longitude: 77.5946,
    timestamp: Date.now(),
    lastUpdated: new Date()
  },
  lastSeen: new Date(),
  createdAt: new Date(),
  updatedAt: new Date()
});
```

**Step 3: Create friendship**
```javascript
// In MongoDB shell or Compass:
db.friends.insertOne({
  userId: "38283786-efcf-45bf-9f8b-42c312285 7b5",  // YOUR userId
  friendUserId: "test-friend-uuid-123",  // Test friend's userId
  status: "accepted",
  source: "device_contact",
  isDeviceContact: true,
  isDeleted: false,
  addedAt: new Date(),
  acceptedAt: new Date(),
  cachedData: {
    name: "Test Friend",
    profileImage: "",
    lastCacheUpdate: new Date()
  }
});
```

**Step 4: Create location settings for test friend**
```javascript
// Get the test friend's MongoDB _id first:
const testFriend = db.users.findOne({ userId: "test-friend-uuid-123" });
console.log("Test friend _id:", testFriend._id);

// Then create location settings:
db.locationsettings.insertOne({
  userId: testFriend._id,  // MongoDB ObjectId, not UUID
  isRealTime: true,
  sharingMode: "all_friends",
  selectedFriends: [],
  activeSessions: [],
  hideAtPlaces: [],
  preferences: {
    showAccuracy: true,
    showBattery: false,
    notifyOnShare: true
  },
  createdAt: new Date(),
  updatedAt: new Date()
});
```

**Step 5: Test Again**
1. Restart app (or just go to Map Tab)
2. You should now see 1 friend on the map!

## Expected Result After Adding Test Friend

**Backend logs:**
```
🔍 [LOCATION] Total friendships for this user in DB: 1
🔍 [LOCATION] Sample friendships: [
  {
    friendUserId: 'test-friend-uuid-123',
    status: 'accepted',
    isDeleted: false
  }
]
👥 [LOCATION] Found 1 accepted friends
📍 [LOCATION] Found 1 friends with location data
✅ [LOCATION] Added Test Friend - 2.3km
✅ [LOCATION] Returning 1 nearby friends
```

**Frontend logs:**
```
✅ [MAP TAB] Loaded 1 nearby friends
📍 [MAP TAB] Friends data: [
  {
    name: 'Test Friend',
    distance: 2.3,
    hasLocation: true
  }
]
```

**Map:**
- Should show a blue marker with Test Friend's profile picture
- Should show distance label
- Should show online status

## Common Issues

### Issue: "Total friendships = 0"
**Cause**: No friends in database
**Fix**: Add friends using steps above

### Issue: "Sample friendships shows wrong status"
**Cause**: Friend status is 'pending' or 'blocked'
**Fix**: Update status to 'accepted':
```javascript
db.friends.updateOne(
  { userId: "YOUR_USER_ID", friendUserId: "FRIEND_USER_ID" },
  { $set: { status: "accepted", acceptedAt: new Date() } }
);
```

### Issue: "Friend has no location"
**Cause**: Friend's currentLocation is null
**Fix**: Add location to friend:
```javascript
db.users.updateOne(
  { userId: "FRIEND_USER_ID" },
  { 
    $set: { 
      currentLocation: {
        latitude: 12.9716,
        longitude: 77.5946,
        timestamp: Date.now(),
        lastUpdated: new Date()
      }
    }
  }
);
```

### Issue: "Friend not sharing location"
**Cause**: No LocationSettings or sharingMode is 'off'
**Fix**: Create/update LocationSettings (see Step 4 above)

## Quick MongoDB Queries

### Check your friends:
```javascript
db.friends.find({ userId: "YOUR_USER_ID" }).pretty()
```

### Check users with location:
```javascript
db.users.find({ 
  "currentLocation.latitude": { $exists: true, $ne: null }
}).pretty()
```

### Check location settings:
```javascript
db.locationsettings.find({}).pretty()
```

### Count total friendships:
```javascript
db.friends.countDocuments({ userId: "YOUR_USER_ID" })
```

## What to Share

After testing, share these logs:
1. Backend console output (the new debug logs)
2. Frontend console output
3. Screenshot of Map Tab

This will tell us exactly what's missing!
