# Contacts Sync Issue - Hidden Contacts Problem

## Problem Description

**User 3 is in your device contacts array in the database, but doesn't show in your Profile tab contact list.**

This causes:
- ❌ User 3 is **excluded from global search** (because database says they're a contact)
- ❌ User 3 **doesn't appear in your contact list** (because they're private or deleted)
- ❌ You can't find them in search AND can't see them in contacts

---

## Root Cause

The backend `/api/users/registered` endpoint filters contacts by `isPublic: true`:

```javascript
const query = {
  isPublic: true,  // Only public users
  ...
};
```

This means:
1. **Database** has User 3 in your `contacts` array ✅
2. **Backend** excludes User 3 from search (because they're in contacts) ✅
3. **Backend** doesn't return User 3 in contact list (because `isPublic: false`) ❌
4. **Result**: User 3 is invisible everywhere! ❌

---

## Quick Diagnosis

Run this script to check your contacts:

```bash
cd d:\Backend
node scripts/fixContactsSync.js "Your Name"
```

This will show:
- ✅ **Public contacts** - Visible in contact list
- 🔒 **Private contacts** - In database but hidden from list
- ❌ **Orphaned contacts** - Deleted users still in your contacts array

---

## Solutions

### Solution 1: Make User 3 Public (Recommended)

If User 3 should be searchable and visible:

```bash
cd d:\Backend
node scripts/setUserPublic.js "User 3"
```

**Result:**
- ✅ User 3 appears in your contact list
- ✅ User 3 is excluded from search (because they're your contact)
- ✅ This is correct behavior!

---

### Solution 2: Remove User 3 from Your Contacts

If User 3 is no longer your contact and should appear in search:

```bash
cd d:\Backend
node scripts/removeFromContacts.js "Your Name" "User 3"
```

**Result:**
- ✅ User 3 removed from your device contacts array
- ✅ User 3 will appear in global search
- ✅ You can send them a connection request

---

### Solution 3: Clean Up Orphaned Contacts

If User 3 was deleted from the database:

```bash
cd d:\Backend
node scripts/cleanupOrphanedContacts.js "Your Name"
```

**Result:**
- ✅ Removes all deleted users from your contacts array
- ✅ Cleans up database inconsistencies

---

## Understanding the Issue

### How Contacts Work

1. **Device Contacts Array** (`user.contacts`):
   - Stores MongoDB ObjectIDs of users from your phone contacts
   - Persists even if user becomes private or is deleted
   - Used to exclude users from global search

2. **Contact List Display**:
   - Fetches users from `contacts` array
   - Filters by `isPublic: true`
   - Only shows public users

3. **Global Search**:
   - Excludes users in `contacts` array
   - Excludes users with `status: 'accepted'` in `appConnections`
   - Only shows `isPublic: true` users

### The Problem Scenario

```
User 1's contacts array: [User2_ID, User3_ID]
User 2: isPublic = true  ✅ Shows in contact list
User 3: isPublic = false ❌ Hidden from contact list

Global Search for User 3:
- Excluded because User3_ID is in User 1's contacts array
- Result: User 3 is invisible!
```

---

## Step-by-Step Fix

### Step 1: Diagnose the Issue

```bash
cd d:\Backend
node scripts/fixContactsSync.js "Your Name"
```

Look for output like:
```
🔒 PRIVATE: User 3 (user_3) - Won't show in contact list
```

---

### Step 2: Decide What You Want

**Option A: User 3 should be your contact**
- Make them public: `node scripts/setUserPublic.js "User 3"`
- They'll appear in your contact list
- They won't appear in search (correct behavior)

**Option B: User 3 is not your contact anymore**
- Remove from contacts: `node scripts/removeFromContacts.js "Your Name" "User 3"`
- They'll appear in search
- They won't appear in contact list

---

### Step 3: Apply the Fix

Choose one of the commands from Step 2 and run it.

---

### Step 4: Verify

1. **Restart backend server**
2. **In the app:**
   - Go to Profile → Refresh Contacts
   - Check if User 3 appears in contact list
3. **Try global search:**
   - Search for User 3
   - Check if they appear in results

---

## All Available Scripts

### Diagnostic Scripts

```bash
# Check your contacts sync status
node scripts/fixContactsSync.js "Your Name"

# Check specific user's connections
node scripts/checkUserConnections.js "User 3"

# Debug why User 3 doesn't appear in search
node scripts/debugSearchIssue.js "Your Name" "User 3"

# Check who is public vs private
node scripts/checkPublicUsers.js
```

### Fix Scripts

```bash
# Make User 3 public
node scripts/setUserPublic.js "User 3"

# Make all users public
node scripts/setAllUsersPublic.js

# Remove User 3 from your contacts
node scripts/removeFromContacts.js "Your Name" "User 3"

# Clean up orphaned contacts
node scripts/cleanupOrphanedContacts.js "Your Name"

# Clean up old connection requests
node scripts/cleanupOldRequests.js
```

---

## Expected Behavior After Fix

### If User 3 is Made Public:
- ✅ Appears in your contact list (Profile tab)
- ❌ Does NOT appear in global search (they're your contact)
- ✅ You can see their profile from contact list
- ✅ This is correct behavior!

### If User 3 is Removed from Contacts:
- ❌ Does NOT appear in your contact list
- ✅ Appears in global search (if they're public)
- ✅ You can send them a connection request
- ✅ This is correct behavior!

---

## Common Scenarios

### Scenario 1: User 3 was your friend, you removed them
**Problem:** They're still in your device contacts array

**Fix:**
```bash
node scripts/removeFromContacts.js "Your Name" "User 3"
```

---

### Scenario 2: User 3 is in your phone contacts but private
**Problem:** They're in contacts array but `isPublic: false`

**Fix:**
```bash
node scripts/setUserPublic.js "User 3"
```

---

### Scenario 3: User 3 deleted their account
**Problem:** Their ID is still in your contacts array

**Fix:**
```bash
node scripts/cleanupOrphanedContacts.js "Your Name"
```

---

## Backend Code Reference

The issue is in `/api/users/registered` endpoint:

```javascript
// userController.js line 382
const query = {
  isPublic: true,  // ← This filters out private users
  ...(excludedUserIds.length > 0 && { userId: { $nin: excludedUserIds } })
};
```

And in global search:

```javascript
// globalSearchController.js line 119
const excludedUserIds = [
  currentUserId,
  ...blockedByCurrentUser.map(b => b.blockedUserId),
  ...blockingCurrentUser.map(b => b.blockerId),
  ...contactUserIds,  // ← Device contacts excluded from search
  ...existingAppConnectionIds
];
```

---

## Prevention

To prevent this issue in the future:

1. **When removing a friend:**
   - Remove from `appConnections` (already done by removeConnection API)
   - Consider removing from `contacts` array if they're not in phone contacts

2. **When syncing contacts:**
   - Clean up orphaned contacts periodically
   - Verify contact users still exist

3. **When user becomes private:**
   - Notify them they won't appear in friends' contact lists
   - Suggest they stay public if they want to be discoverable

---

## Need Help?

Run the diagnostic script first:
```bash
node scripts/fixContactsSync.js "Your Name"
```

It will tell you exactly what's wrong and how to fix it!
