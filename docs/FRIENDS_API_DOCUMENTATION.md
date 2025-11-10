# Friends API Documentation

## Overview

The Friends API provides a persistent, reliable system for managing user relationships in the application. It replaces the unstable contacts + appConnections system with a single source of truth.

**Base URL:** `/api/friends`

**Authentication:** All endpoints require authentication via JWT token in the `Authorization` header.

---

## Table of Contents

1. [Get Friends](#1-get-friends)
2. [Get Friend Requests](#2-get-friend-requests)
3. [Send Friend Request](#3-send-friend-request)
4. [Accept Friend Request](#4-accept-friend-request)
5. [Reject Friend Request](#5-reject-friend-request)
6. [Remove Friend](#6-remove-friend)
7. [Block User](#7-block-user)
8. [Unblock User](#8-unblock-user)
9. [Sync Device Contacts](#9-sync-device-contacts)
10. [Search Users](#10-search-users)
11. [Get Mutual Friends](#11-get-mutual-friends)
12. [Update Friend Settings](#12-update-friend-settings)
13. [Refresh Friend Cache](#13-refresh-friend-cache)
14. [WebSocket Events](#websocket-events)

---

## 1. Get Friends

Get all friends for the authenticated user.

**Endpoint:** `GET /api/friends`

**Query Parameters:**
- `status` (optional): Filter by status (`accepted`, `pending`, `blocked`). Default: `accepted`
- `includeDeviceContacts` (optional): Include device contacts. Default: `true`
- `includeAppConnections` (optional): Include app connections. Default: `true`
- `limit` (optional): Number of results. Default: `1000`
- `skip` (optional): Number to skip for pagination. Default: `0`
- `sortBy` (optional): Sort field. Default: `addedAt`
- `sortOrder` (optional): Sort order (`1` for ascending, `-1` for descending). Default: `-1`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "friendUserId": "user123",
      "name": "John Doe",
      "profileImage": "https://...",
      "username": "johndoe",
      "isOnline": true,
      "lastSeen": "2025-01-10T12:00:00.000Z",
      "source": "device_contact",
      "status": "accepted",
      "addedAt": "2025-01-01T10:00:00.000Z",
      "isDeviceContact": true,
      "phoneNumber": "+1234567890",
      "settings": {
        "showOnlineStatus": true,
        "showStories": true,
        "showPosts": true,
        "showLocation": false,
        "muteNotifications": false
      },
      "interactions": {
        "lastMessageAt": "2025-01-10T11:00:00.000Z",
        "messageCount": 150
      }
    }
  ],
  "count": 1
}
```

---

## 2. Get Friend Requests

Get pending friend requests.

**Endpoint:** `GET /api/friends/requests`

**Query Parameters:**
- `type` (optional): Request type (`received` or `sent`). Default: `received`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "requestId": "req123",
      "userId": "user456",
      "friendUserId": "user789",
      "name": "Jane Smith",
      "profileImage": "https://...",
      "username": "janesmith",
      "requestMessage": "Hi! Let's connect",
      "mutualFriends": ["user111", "user222"],
      "addedAt": "2025-01-10T09:00:00.000Z",
      "source": "app_search"
    }
  ],
  "count": 1,
  "type": "received"
}
```

---

## 3. Send Friend Request

Send a friend request to another user.

**Endpoint:** `POST /api/friends/add`

**Request Body:**
```json
{
  "friendUserId": "user789",  // OR username OR phoneNumber
  "username": "janesmith",    // Alternative to friendUserId
  "phoneNumber": "+1234567890", // Alternative to friendUserId
  "message": "Hi! Let's connect", // Optional
  "source": "app_search"      // Optional: device_contact, app_search, qr_code, etc.
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "requestId": "req123",
    "userId": "user456",
    "friendUserId": "user789",
    "status": "pending",
    "addedAt": "2025-01-10T12:00:00.000Z",
    "mutualFriends": ["user111"]
  },
  "message": "Friend request sent successfully"
}
```

---

## 4. Accept Friend Request

Accept a pending friend request.

**Endpoint:** `POST /api/friends/accept/:requestId`

**URL Parameters:**
- `requestId`: The friend request ID

**Response:**
```json
{
  "success": true,
  "data": {
    "requestId": "req123",
    "userId": "user456",
    "friendUserId": "user789",
    "status": "accepted",
    "acceptedAt": "2025-01-10T12:05:00.000Z"
  },
  "message": "Friend request accepted successfully"
}
```

---

## 5. Reject Friend Request

Reject a pending friend request.

**Endpoint:** `POST /api/friends/reject/:requestId`

**URL Parameters:**
- `requestId`: The friend request ID

**Response:**
```json
{
  "success": true,
  "data": {
    "requestId": "req123",
    "status": "rejected"
  },
  "message": "Friend request rejected successfully"
}
```

---

## 6. Remove Friend

Remove a friend (soft delete).

**Endpoint:** `DELETE /api/friends/:friendUserId`

**URL Parameters:**
- `friendUserId`: The friend's user ID

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user456",
    "friendUserId": "user789",
    "status": "removed",
    "removedAt": "2025-01-10T12:10:00.000Z"
  },
  "message": "Friend removed successfully"
}
```

---

## 7. Block User

Block a user.

**Endpoint:** `POST /api/friends/block/:userId`

**URL Parameters:**
- `userId`: The user ID to block

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user456",
    "blockedUserId": "user789",
    "status": "blocked",
    "blockedAt": "2025-01-10T12:15:00.000Z"
  },
  "message": "User blocked successfully"
}
```

---

## 8. Unblock User

Unblock a previously blocked user.

**Endpoint:** `POST /api/friends/unblock/:userId`

**URL Parameters:**
- `userId`: The user ID to unblock

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user456",
    "blockedUserId": "user789",
    "status": "unblocked"
  },
  "message": "User unblocked successfully"
}
```

---

## 9. Sync Device Contacts

Sync device contacts to create friendships with registered users.

**Endpoint:** `POST /api/friends/sync-contacts`

**Request Body:**
```json
{
  "phoneNumbers": [
    "+1234567890",
    "+0987654321",
    "+1122334455"
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "newFriends": [
      {
        "friendUserId": "user789",
        "name": "Jane Smith",
        "phoneNumber": "+1234567890",
        "profileImage": "https://...",
        "username": "janesmith"
      }
    ],
    "removedContacts": 0,
    "totalFriends": 25
  },
  "message": "Synced 1 new friends, 25 total friends"
}
```

---

## 10. Search Users

Search for users to add as friends.

**Endpoint:** `GET /api/friends/search`

**Query Parameters:**
- `query` (required): Search query (username, name, or phone number)
- `limit` (optional): Number of results. Default: `20`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "userId": "user789",
      "name": "Jane Smith",
      "username": "janesmith",
      "profileImage": "https://...",
      "phoneNumber": "+1234567890",
      "mutualFriendsCount": 3
    }
  ],
  "count": 1,
  "query": "jane"
}
```

---

## 11. Get Mutual Friends

Get mutual friends between authenticated user and another user.

**Endpoint:** `GET /api/friends/mutual/:userId`

**URL Parameters:**
- `userId`: The other user's ID

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "userId": "user111",
      "name": "Bob Johnson",
      "profileImage": "https://...",
      "username": "bobjohnson"
    }
  ],
  "count": 1
}
```

---

## 12. Update Friend Settings

Update privacy/notification settings for a specific friend.

**Endpoint:** `PUT /api/friends/:friendUserId/settings`

**URL Parameters:**
- `friendUserId`: The friend's user ID

**Request Body:**
```json
{
  "showOnlineStatus": true,
  "showStories": true,
  "showPosts": true,
  "showLocation": false,
  "muteNotifications": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "friendUserId": "user789",
    "settings": {
      "showOnlineStatus": true,
      "showStories": true,
      "showPosts": true,
      "showLocation": false,
      "muteNotifications": false
    }
  },
  "message": "Friend settings updated successfully"
}
```

---

## 13. Refresh Friend Cache

Refresh cached data for all friends (name, profile image, etc.).

**Endpoint:** `POST /api/friends/refresh-cache`

**Response:**
```json
{
  "success": true,
  "data": {
    "updated": 5,
    "total": 25
  },
  "message": "Refreshed 5 of 25 friend caches"
}
```

---

## WebSocket Events

The Friends system broadcasts real-time updates via WebSocket.

### Events Sent to Clients:

#### `friend:request_received`
Sent when a user receives a friend request.
```json
{
  "requestId": "req123",
  "fromUserId": "user456",
  "fromName": "John Doe",
  "fromProfileImage": "https://...",
  "fromUsername": "johndoe",
  "message": "Hi! Let's connect",
  "mutualFriends": ["user111"],
  "timestamp": "2025-01-10T12:00:00.000Z"
}
```

#### `friend:request_accepted`
Sent when a friend request is accepted.
```json
{
  "friendUserId": "user789",
  "friendName": "Jane Smith",
  "friendProfileImage": "https://...",
  "friendUsername": "janesmith",
  "acceptedAt": "2025-01-10T12:05:00.000Z",
  "timestamp": "2025-01-10T12:05:00.000Z"
}
```

#### `friend:request_rejected`
Sent when a friend request is rejected.
```json
{
  "rejectedByUserId": "user789",
  "timestamp": "2025-01-10T12:06:00.000Z"
}
```

#### `friend:removed`
Sent when a friend is removed.
```json
{
  "removedByUserId": "user456",
  "timestamp": "2025-01-10T12:10:00.000Z"
}
```

#### `friend:blocked`
Sent when a user is blocked.
```json
{
  "blockedByUserId": "user456",
  "timestamp": "2025-01-10T12:15:00.000Z"
}
```

#### `friend:new_from_sync`
Sent when a new friend is added from device contact sync.
```json
{
  "friendUserId": "user789",
  "friendName": "Jane Smith",
  "friendProfileImage": "https://...",
  "friendUsername": "janesmith",
  "phoneNumber": "+1234567890",
  "timestamp": "2025-01-10T12:20:00.000Z"
}
```

#### `friend:cache_updated`
Sent when friend cached data is updated.
```json
{
  "friendUserId": "user789",
  "friendName": "Jane Smith Updated",
  "friendProfileImage": "https://...",
  "friendUsername": "janesmith",
  "isOnline": true,
  "lastSeen": "2025-01-10T12:25:00.000Z",
  "timestamp": "2025-01-10T12:25:00.000Z"
}
```

#### `friend:list_updated`
Sent when friend list is updated (general update).
```json
{
  "action": "synced",  // 'added', 'removed', 'synced'
  "count": 25,
  "timestamp": "2025-01-10T12:30:00.000Z"
}
```

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error message here"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (authentication required)
- `404` - Not Found
- `500` - Internal Server Error

---

## Migration from Old System

### Before (Unstable):
```javascript
// Multiple sources, unreliable
const contacts = user.contacts; // Device contacts (ObjectId references)
const appConnections = user.appConnections; // App connections (embedded)
const cachedContacts = user.cachedContacts; // Cached data

// Merge and hope for the best
const allContacts = [...contacts, ...appConnections];
```

### After (Stable):
```javascript
// Single source of truth
const friends = await fetch('/api/friends');
// That's it! Persistent, reliable, always available
```

---

## Best Practices

1. **Cache Locally**: Cache the friends list in the frontend for offline access
2. **Listen to WebSocket**: Subscribe to friend events for real-time updates
3. **Sync Periodically**: Sync device contacts every 24 hours in the background
4. **Refresh Cache**: Call `/api/friends/refresh-cache` weekly to update friend data
5. **Handle Errors**: Always handle network errors gracefully

---

## Example Usage (Frontend)

```typescript
// Get all friends
const friends = await friendsService.getFriends();

// Send friend request
await friendsService.sendFriendRequest('user789', 'Hi!');

// Accept friend request
await friendsService.acceptFriendRequest('req123');

// Sync device contacts
const contacts = await getDeviceContacts();
const phoneNumbers = contacts.map(c => c.phoneNumber);
await friendsService.syncDeviceContacts(phoneNumbers);

// Listen to WebSocket events
socket.on('friend:request_received', (data) => {
  showNotification(`${data.fromName} sent you a friend request`);
  refreshFriendRequests();
});

socket.on('friend:list_updated', (data) => {
  refreshFriendsList();
});
```

---

## Database Schema

### Friend Model

```javascript
{
  userId: String,              // Owner of this friendship
  friendUserId: String,        // The friend
  source: String,              // How they became friends
  status: String,              // pending, accepted, blocked, removed
  addedAt: Date,
  acceptedAt: Date,
  isDeviceContact: Boolean,
  phoneNumber: String,
  lastDeviceSync: Date,
  cachedData: {
    name: String,
    profileImage: String,
    username: String,
    isOnline: Boolean,
    lastSeen: Date,
    lastCacheUpdate: Date
  },
  interactions: {
    lastMessageAt: Date,
    lastCallAt: Date,
    messageCount: Number,
    callCount: Number
  },
  settings: {
    showOnlineStatus: Boolean,
    showStories: Boolean,
    showPosts: Boolean,
    showLocation: Boolean,
    muteNotifications: Boolean
  },
  requestMetadata: {
    requestedBy: String,
    requestMessage: String,
    mutualFriends: [String]
  },
  isDeleted: Boolean
}
```

### Indexes

- `{ userId: 1, friendUserId: 1 }` - Unique compound index
- `{ userId: 1, status: 1 }` - Get friends by status
- `{ userId: 1, isDeviceContact: 1 }` - Get device contacts
- `{ phoneNumber: 1 }` - Contact sync lookup
- `{ 'cachedData.username': 1 }` - Username search

---

## Support

For issues or questions, contact the backend team or refer to the main API documentation.

**Version:** 1.0.0  
**Last Updated:** January 10, 2025
