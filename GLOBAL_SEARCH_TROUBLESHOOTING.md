# Global Search Troubleshooting Guide

## Problem: Users Not Appearing in Global Search

### Root Cause
The `isPublic` field in the User model defaults to `false`. This means:
- **New users** are private by default
- **Existing users** need to manually enable "Public Profile"
- Only users with `isPublic: true` appear in global search

---

## Quick Fix Options

### Option 1: Check Current Status (Recommended First Step)
```bash
cd d:\Backend
node scripts/checkPublicUsers.js
```

This will show:
- Total users in database
- How many are public vs private
- List of all users and their public status

---

### Option 2: Make All Users Public (Quick Fix)
```bash
cd d:\Backend
node scripts/setAllUsersPublic.js
```

This will:
- Update ALL users to `isPublic: true`
- Make everyone searchable immediately
- Show before/after statistics

⚠️ **Warning:** This makes ALL users public. They can disable it later in their profile settings.

---

### Option 3: Make Specific User Public
```bash
cd d:\Backend
node scripts/setUserPublic.js "User Name"
# OR
node scripts/setUserPublic.js user_123
# OR
node scripts/setUserPublic.js username
```

This will:
- Find the user by name, userId, or username
- Update only that user to `isPublic: true`
- Show the user's details

---

## Manual Fix (Using App)

Users can enable public profile themselves:

1. Open the app
2. Go to **Profile** tab
3. Scroll to **Privacy Settings** section
4. Toggle **"Public Profile"** to ON
5. Confirm the alert

The user will now appear in global search!

---

## Verification Steps

### 1. Check Backend Logs
When searching, look for these logs:
```
🔍 Global search: "query" by user user_123
🔍 [CRITICAL DEBUG] Total public users in database: X
```

If it shows `0` public users, run Option 2 above.

### 2. Check Frontend Logs
In React Native debugger, look for:
```
🔍 FeedTab: Searching for "query"
✅ FeedTab: Found X users
```

If it shows `0` users, the backend has no public users.

### 3. Test Search Flow
1. **User A**: Enable "Public Profile" toggle
2. **User B**: Search for User A's name
3. **Expected**: User A appears in results
4. **User B**: Can send connection request

---

## Common Issues

### Issue 1: "No users found" even after enabling public profile
**Solution:**
- Restart the backend server
- Clear app cache and restart
- Verify database connection

### Issue 2: User appears but can't send connection request
**Solution:**
- Check if users are already connected
- Check if there's a pending request
- Check if user is blocked

### Issue 3: Search returns 404 error
**Solution:**
- Verify backend is running on correct port
- Check API base URL in frontend config
- Verify `/api/search/users` route is registered

---

## Database Query

To manually check in MongoDB:

```javascript
// Count public users
db.users.countDocuments({ isPublic: true })

// List all public users
db.users.find({ isPublic: true }, { name: 1, userId: 1, username: 1, isPublic: 1 })

// Update specific user to public
db.users.updateOne(
  { userId: "user_123" },
  { $set: { isPublic: true } }
)

// Update ALL users to public
db.users.updateMany(
  {},
  { $set: { isPublic: true } }
)
```

---

## API Endpoints

### Search Users (POST)
```
POST /api/search/users
Body: {
  "query": "search term",
  "limit": 20,
  "offset": 0
}
```

### Update Profile (PUT)
```
PUT /api/users/profile
Body: {
  "isPublic": true
}
Headers: {
  "Authorization": "Bearer <token>"
}
```

### Set User Public (POST) - Debug Only
```
POST /api/users/set-public
Body: {
  "isPublic": true
}
Headers: {
  "Authorization": "Bearer <token>"
}
```

---

## Testing Checklist

- [ ] Backend server is running
- [ ] Database is connected
- [ ] At least one user has `isPublic: true`
- [ ] Frontend is using correct API endpoint (`POST /search/users`)
- [ ] User has valid authentication token
- [ ] Search query is at least 2 characters
- [ ] Users are not already connected
- [ ] Users have not blocked each other

---

## Need More Help?

1. Run `node scripts/checkPublicUsers.js` and share output
2. Check backend console for search logs
3. Check React Native debugger for frontend logs
4. Verify MongoDB connection and data
