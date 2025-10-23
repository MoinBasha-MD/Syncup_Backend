# Search After Removing Friend - Troubleshooting Guide

## Problem
**User 3 was your friend, you removed them, but they still don't appear in global search.**

---

## How Search Exclusion Works

The global search **intentionally excludes** these users:
1. ✅ **Yourself** (you can't search for yourself)
2. ✅ **Currently accepted connections** (status: 'accepted')
3. ✅ **Device contacts** (from phone contacts)
4. ✅ **Blocked users** (mutual blocking)
5. ❌ **Private users** (isPublic: false)

**IMPORTANT:** Only **accepted** connections are excluded. Declined, cancelled, or removed connections should NOT be excluded.

---

## Why User 3 Might Not Appear

### Reason 1: User 3 is Not Public ⚠️
**Most Common Issue!**

Check if User 3 has enabled "Public Profile":
```bash
cd d:\Backend
node scripts/checkPublicUsers.js
```

**Fix:**
```bash
# Make User 3 public
node scripts/setUserPublic.js "User 3"
# OR
node scripts/setUserPublic.js user_3
```

---

### Reason 2: Connection Not Fully Removed
The connection might still exist with 'accepted' status in the database.

**Check connection status:**
```bash
cd d:\Backend
node scripts/checkUserConnections.js "Your Name"
```

This shows all your connections and their statuses.

**Fix:**
If User 3 still shows as 'accepted', remove them properly:
1. In the app, go to their profile
2. Tap "Remove Connection" or "Unfriend"
3. Confirm removal

---

### Reason 3: User 3 is in Device Contacts
If User 3's phone number is in your device contacts, they're excluded from search.

**This is by design** - you already have them in your contacts!

**No fix needed** - this is expected behavior.

---

### Reason 4: Stale Data / Cache
The app or backend might have cached old data.

**Fix:**
1. **Backend:** Restart the server
2. **App:** Force close and restart
3. **App:** Clear cache (if available in settings)

---

## Diagnostic Scripts

### Script 1: Debug Specific Search Issue
**Best for your case!**
```bash
cd d:\Backend
node scripts/debugSearchIssue.js "Your Name" "User 3"
```

This will:
- Check if User 3 is public
- Check if you're still connected
- Check if User 3 is in device contacts
- Show exactly why they don't appear
- Suggest specific fixes

---

### Script 2: Check Your Connections
```bash
cd d:\Backend
node scripts/checkUserConnections.js "Your Name"
```

This shows:
- All your app connections (with status)
- All your device contacts
- All outgoing/incoming requests
- Connection breakdown by status

---

### Script 3: Check User 3's Status
```bash
cd d:\Backend
node scripts/checkUserConnections.js "User 3"
```

This shows:
- If User 3 is public
- User 3's connections
- User 3's connection requests

---

### Script 4: Clean Up Old Requests
```bash
cd d:\Backend
node scripts/cleanupOldRequests.js
```

This removes old declined/cancelled requests (>7 days old).

---

## Step-by-Step Fix

### Step 1: Run Diagnostic
```bash
cd d:\Backend
node scripts/debugSearchIssue.js "Your Name" "User 3"
```

This will tell you exactly what's wrong.

---

### Step 2: Apply the Fix

**If User 3 is not public:**
```bash
node scripts/setUserPublic.js "User 3"
```

**If still connected:**
- Remove connection properly in the app
- OR check if connection status is stuck

**If in device contacts:**
- This is expected behavior
- No fix needed (they're already in your contacts)

---

### Step 3: Verify
1. Restart backend server
2. Restart app
3. Try searching for User 3 again
4. Check backend logs for search results

---

## Expected Behavior

### ✅ SHOULD Appear in Search:
- Public users (isPublic: true)
- Not currently connected (no 'accepted' status)
- Not in device contacts
- Not blocked

### ❌ SHOULD NOT Appear in Search:
- Private users (isPublic: false)
- Currently connected friends ('accepted' status)
- Users in device contacts
- Blocked users
- Yourself

---

## Backend Logs to Check

When you search, look for these logs:

```
🔍 Global search: "User 3" by user your_user_id
🔍 [CONNECTION STATUS] App connections breakdown:
   total: X
   accepted: Y
   declined: Z
   cancelled: W
🔍 [CRITICAL DEBUG] Total public users in database: N
✅ SearchService: Found X users
```

**If "Total public users" is 0:**
- Run `node scripts/setAllUsersPublic.js`

**If "accepted" count includes User 3:**
- Connection not properly removed
- Remove again in app

---

## Quick Commands Reference

```bash
# Check who is public
node scripts/checkPublicUsers.js

# Make all users public
node scripts/setAllUsersPublic.js

# Make specific user public
node scripts/setUserPublic.js "User 3"

# Debug why User 3 doesn't appear
node scripts/debugSearchIssue.js "Your Name" "User 3"

# Check your connections
node scripts/checkUserConnections.js "Your Name"

# Check User 3's connections
node scripts/checkUserConnections.js "User 3"

# Clean up old requests
node scripts/cleanupOldRequests.js
```

---

## Still Not Working?

1. **Check backend logs** during search
2. **Check React Native debugger** logs
3. **Verify MongoDB connection**
4. **Restart everything** (backend + app)
5. **Run all diagnostic scripts** and share output

---

## Contact for Help

If issue persists, provide:
1. Output of `debugSearchIssue.js`
2. Output of `checkUserConnections.js` for both users
3. Backend logs during search
4. Frontend logs from React Native debugger
