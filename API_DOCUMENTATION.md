# API Documentation

## Authentication APIs

### Register User
- **URL**: `/api/auth/register`
- **Method**: `POST`
- **Auth required**: No
- **Request body**:
```json
{
  "name": "John Doe",
  "phoneNumber": "1234567890",
  "email": "john@example.com",
  "password": "password123"
}
```
- **Success Response**: `201 Created`
```json
{
  "success": true,
  "data": {
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "name": "John Doe",
    "phoneNumber": "1234567890",
    "email": "john@example.com",
    "status": "available",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```
- **Error Response**: `400 Bad Request` if user already exists or data is invalid

### Login User
- **URL**: `/api/auth/login`
- **Method**: `POST`
- **Auth required**: No
- **Request body**:
```json
{
  "phoneNumber": "1234567890",
  "password": "password123"
}
```
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "name": "John Doe",
    "phoneNumber": "1234567890",
    "email": "john@example.com",
    "status": "available",
    "customStatus": "",
    "statusUntil": null,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```
- **Error Response**: `401 Unauthorized` if credentials are invalid

### Check User Exists
- **URL**: `/api/auth/check`
- **Method**: `POST`
- **Auth required**: No
- **Request body**:
```json
{
  "phoneNumber": "1234567890"
}
```
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "exists": true,
  "data": {
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "name": "John Doe"
  }
}
```

## User Data APIs

### Get User Data
- **URL**: `/api/users/:userId/data`
- **Method**: `GET`
- **Auth required**: Yes
- **URL Parameters**: `userId=[UUID]`
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "name": "John Doe",
    "email": "john@example.com",
    "phoneNumber": "1234567890",
    "status": "available",
    "customStatus": "",
    "statusUntil": null,
    "createdAt": "2023-01-01T00:00:00.000Z",
    "updatedAt": "2023-01-01T00:00:00.000Z"
  }
}
```
- **Error Response**: `404 Not Found` if user doesn't exist or `403 Forbidden` if not authorized

### Get User Profile
- **URL**: `/api/users/:userId/profile`
- **Method**: `GET`
- **Auth required**: Yes
- **URL Parameters**: `userId=[UUID]`
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "profile": {
      "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
      "name": "John Doe",
      "email": "john@example.com",
      "phoneNumber": "1234567890",
      "status": "available",
      "customStatus": "",
      "statusUntil": null,
      "createdAt": "2023-01-01T00:00:00.000Z",
      "updatedAt": "2023-01-01T00:00:00.000Z"
    },
    "recentHistory": [...],
    "activeSchedules": [...],
    "templates": [...]
  }
}
```

### Update User Profile
- **URL**: `/api/users/profile`
- **Method**: `PUT`
- **Auth required**: Yes
- **Request body**:
```json
{
  "name": "John Smith",
  "email": "john.smith@example.com",
  "phoneNumber": "0987654321",
  "password": "newpassword123"
}
```
- **Success Response**: `200 OK`
```json
{
  "_id": "60d21b4667d0d8992e610c85",
  "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
  "name": "John Smith",
  "phoneNumber": "0987654321",
  "email": "john.smith@example.com",
  "status": "available",
  "customStatus": "",
  "statusUntil": null,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

## Status Management APIs

### Get Current User Status
- **URL**: `/api/status-management`
- **Method**: `GET`
- **Auth required**: Yes
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "status": "busy",
    "customStatus": "In a meeting",
    "statusUntil": "2023-01-01T01:00:00.000Z"
  }
}
```

### Update User Status
- **URL**: `/api/status-management`
- **Method**: `PUT`
- **Auth required**: Yes
- **Request body**:
```json
{
  "status": "busy",
  "customStatus": "In a meeting",
  "duration": 60
}
```
- **Notes**:
  - `status` can be one of: `available`, `busy`, `away`, `dnd`, `at_work`, `at_home`, `at_school`, `at_college`, `at_hospital`, `meeting`, `driving`, `commuting`, `working_out`, `eating`, `sleeping`, `studying`, `custom`
  - `customStatus` is required if `status` is `custom`
  - `duration` is in minutes and optional. If provided, the status will automatically revert to `available` after the specified duration.
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "status": "busy",
    "customStatus": "In a meeting",
    "statusUntil": "2023-01-01T01:00:00.000Z"
  }
}
```

### Get Specific User Status
- **URL**: `/api/status-management/:userId`
- **Method**: `GET`
- **Auth required**: Yes
- **URL Parameters**: `userId=[UUID]`
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "status": "busy",
    "customStatus": "In a meeting",
    "statusUntil": "2023-01-01T01:00:00.000Z"
  }
}
```

## Status History APIs

### Get User Status History
- **URL**: `/api/users/:userId/history`
- **Method**: `GET`
- **Auth required**: Yes
- **URL Parameters**: `userId=[UUID]`
- **Query Parameters**:
  - `page=[integer]` (optional, default: 1)
  - `limit=[integer]` (optional, default: 10)
  - `startDate=[ISO date]` (optional)
  - `endDate=[ISO date]` (optional)
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "_id": "60d21b4667d0d8992e610c85",
      "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
      "status": "busy",
      "customStatus": "In a meeting",
      "startTime": "2023-01-01T00:00:00.000Z",
      "endTime": "2023-01-01T01:00:00.000Z",
      "duration": 60
    },
    ...
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "pages": 5
  }
}
```

### Create Status History Entry
- **URL**: `/api/status/history`
- **Method**: `POST`
- **Auth required**: Yes
- **Request body**:
```json
{
  "status": "busy",
  "customStatus": "In a meeting",
  "startTime": "2023-01-01T00:00:00.000Z",
  "endTime": "2023-01-01T01:00:00.000Z"
}
```
- **Success Response**: `201 Created`
```json
{
  "_id": "60d21b4667d0d8992e610c85",
  "user": "60d21b4667d0d8992e610c85",
  "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
  "status": "busy",
  "customStatus": "In a meeting",
  "startTime": "2023-01-01T00:00:00.000Z",
  "endTime": "2023-01-01T01:00:00.000Z",
  "duration": 60
}
```

### Delete Status History Entry
- **URL**: `/api/status/history/:id`
- **Method**: `DELETE`
- **Auth required**: Yes
- **URL Parameters**: `id=[MongoDB ObjectId]`
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "message": "Status history entry deleted"
}
```

### Get Status Analytics
- **URL**: `/api/users/:userId/analytics`
- **Method**: `GET`
- **Auth required**: Yes
- **URL Parameters**: `userId=[UUID]`
- **Query Parameters**:
  - `startDate=[ISO date]` (optional)
  - `endDate=[ISO date]` (optional)
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "totalEntries": 50,
    "totalDuration": 1440,
    "statusDurations": {
      "busy": 480,
      "available": 600,
      "away": 360
    },
    "statusPercentages": {
      "busy": 33,
      "available": 42,
      "away": 25
    },
    "mostFrequentStatus": "available",
    "suggestions": {
      "morning": "busy",
      "afternoon": "available",
      "evening": "away"
    }
  }
}
```

## Status Templates APIs

### Get User Status Templates
- **URL**: `/api/users/:userId/templates`
- **Method**: `GET`
- **Auth required**: Yes
- **URL Parameters**: `userId=[UUID]`
- **Query Parameters**:
  - `page=[integer]` (optional, default: 1)
  - `limit=[integer]` (optional, default: 10)
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "_id": "60d21b4667d0d8992e610c85",
      "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
      "name": "Meeting",
      "status": "busy",
      "customStatus": "In a meeting",
      "duration": 60
    },
    ...
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 5,
    "pages": 1
  }
}
```

### Create Status Template
- **URL**: `/api/status/templates`
- **Method**: `POST`
- **Auth required**: Yes
- **Request body**:
```json
{
  "name": "Meeting",
  "status": "busy",
  "customStatus": "In a meeting",
  "duration": 60
}
```
- **Success Response**: `201 Created`
```json
{
  "_id": "60d21b4667d0d8992e610c85",
  "user": "60d21b4667d0d8992e610c85",
  "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
  "name": "Meeting",
  "status": "busy",
  "customStatus": "In a meeting",
  "duration": 60
}
```

### Update Status Template
- **URL**: `/api/status/templates/:id`
- **Method**: `PUT`
- **Auth required**: Yes
- **URL Parameters**: `id=[MongoDB ObjectId]`
- **Request body**:
```json
{
  "name": "Long Meeting",
  "status": "busy",
  "customStatus": "In an important meeting",
  "duration": 120
}
```
- **Success Response**: `200 OK`
```json
{
  "_id": "60d21b4667d0d8992e610c85",
  "user": "60d21b4667d0d8992e610c85",
  "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
  "name": "Long Meeting",
  "status": "busy",
  "customStatus": "In an important meeting",
  "duration": 120
}
```

### Delete Status Template
- **URL**: `/api/status/templates/:id`
- **Method**: `DELETE`
- **Auth required**: Yes
- **URL Parameters**: `id=[MongoDB ObjectId]`
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "message": "Status template deleted"
}
```

## Status Schedules APIs

### Get User Status Schedules
- **URL**: `/api/users/:userId/schedules`
- **Method**: `GET`
- **Auth required**: Yes
- **URL Parameters**: `userId=[UUID]`
- **Query Parameters**:
  - `page=[integer]` (optional, default: 1)
  - `limit=[integer]` (optional, default: 10)
  - `active=[boolean]` (optional, default: true)
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "_id": "60d21b4667d0d8992e610c85",
      "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
      "status": "busy",
      "customStatus": "In a meeting",
      "startTime": "2023-01-01T09:00:00.000Z",
      "endTime": "2023-01-01T10:00:00.000Z",
      "repeat": "weekly",
      "active": true
    },
    ...
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 5,
    "pages": 1
  }
}
```

### Create Status Schedule
- **URL**: `/api/users/:userId/schedules`
- **Method**: `POST`
- **Auth required**: Yes
- **URL Parameters**: `userId=[UUID]` - The unique identifier of the user
- **Request body**:
```json
{
  "status": "busy",
  "customStatus": "In a meeting",
  "startTime": "2023-01-01T09:00:00.000Z",
  "endTime": "2023-01-01T10:00:00.000Z",
  "repeat": "weekly"
}
```
- **Notes**:
  - `repeat` can be one of: `none`, `daily`, `weekdays`, `weekly`, `monthly`
- **Success Response**: `201 Created`
```json
{
  "success": true,
  "data": {
    "_id": "60d21b4667d0d8992e610c85",
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "status": "busy",
    "customStatus": "In a meeting",
    "startTime": "2023-01-01T09:00:00.000Z",
    "endTime": "2023-01-01T10:00:00.000Z",
    "repeat": "weekly",
    "active": true
  }
}
```

### Update Status Schedule
- **URL**: `/api/users/:userId/schedules/:id`
- **Method**: `PUT`
- **Auth required**: Yes
- **URL Parameters**: 
  - `userId=[UUID]` - The unique identifier of the user
  - `id=[MongoDB ObjectId]` - The ID of the schedule to update
- **Request body**:
```json
{
  "status": "busy",
  "customStatus": "In a team meeting",
  "startTime": "2023-01-01T09:30:00.000Z",
  "endTime": "2023-01-01T10:30:00.000Z",
  "repeat": "weekly",
  "active": true
}
```
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "_id": "60d21b4667d0d8992e610c85",
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "status": "busy",
    "customStatus": "In a team meeting",
    "startTime": "2023-01-01T09:30:00.000Z",
    "endTime": "2023-01-01T10:30:00.000Z",
    "repeat": "weekly",
    "active": true
  }
}
```

### Delete Status Schedule
- **URL**: `/api/users/:userId/schedules/:id`
- **Method**: `DELETE`
- **Auth required**: Yes
- **URL Parameters**: 
  - `userId=[UUID]` - The unique identifier of the user
  - `id=[MongoDB ObjectId]` - The ID of the schedule to delete
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "message": "Status schedule deleted"
}
```

### Get Upcoming Status Schedules
- **URL**: `/api/status/schedules/upcoming`
- **Method**: `GET`
- **Auth required**: Yes
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "_id": "60d21b4667d0d8992e610c85",
      "user": "60d21b4667d0d8992e610c85",
      "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
      "status": "busy",
      "customStatus": "In a meeting",
      "startTime": "2023-01-01T09:00:00.000Z",
      "endTime": "2023-01-01T10:00:00.000Z",
      "repeat": "weekly",
      "active": true
    },
    ...
  ]
}
```

## Bulk Operations APIs

### Bulk Create Status Templates
- **URL**: `/api/bulk/templates/bulk`
- **Method**: `POST`
- **Auth required**: Yes
- **Request body**:
```json
[
  {
    "name": "Meeting",
    "status": "busy",
    "customStatus": "In a meeting",
    "duration": 60
  },
  {
    "name": "Lunch",
    "status": "eating",
    "customStatus": "Having lunch",
    "duration": 45
  }
]
```
- **Success Response**: `201 Created`
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "60d21b4667d0d8992e610c85",
      "user": "60d21b4667d0d8992e610c85",
      "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
      "name": "Meeting",
      "status": "busy",
      "customStatus": "In a meeting",
      "duration": 60
    },
    {
      "_id": "60d21b4667d0d8992e610c86",
      "user": "60d21b4667d0d8992e610c85",
      "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
      "name": "Lunch",
      "status": "eating",
      "customStatus": "Having lunch",
      "duration": 45
    }
  ]
}
```

### Bulk Create Status Schedules
- **URL**: `/api/bulk/schedules/bulk`
- **Method**: `POST`
- **Auth required**: Yes
- **Request body**:
```json
[
  {
    "status": "busy",
    "customStatus": "Team meeting",
    "startTime": "2023-01-01T09:00:00.000Z",
    "endTime": "2023-01-01T10:00:00.000Z",
    "repeat": "weekly"
  },
  {
    "status": "eating",
    "customStatus": "Lunch break",
    "startTime": "2023-01-01T12:00:00.000Z",
    "endTime": "2023-01-01T13:00:00.000Z",
    "repeat": "weekdays"
  }
]
```
- **Success Response**: `201 Created`
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "60d21b4667d0d8992e610c85",
      "user": "60d21b4667d0d8992e610c85",
      "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
      "status": "busy",
      "customStatus": "Team meeting",
      "startTime": "2023-01-01T09:00:00.000Z",
      "endTime": "2023-01-01T10:00:00.000Z",
      "repeat": "weekly",
      "active": true
    },
    {
      "_id": "60d21b4667d0d8992e610c86",
      "user": "60d21b4667d0d8992e610c85",
      "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
      "status": "eating",
      "customStatus": "Lunch break",
      "startTime": "2023-01-01T12:00:00.000Z",
      "endTime": "2023-01-01T13:00:00.000Z",
      "repeat": "weekdays",
      "active": true
    }
  ]
}
```

### Sync Status with Calendar
- **URL**: `/api/bulk/sync/calendar`
- **Method**: `POST`
- **Auth required**: Yes
- **Request body**:
```json
{
  "calendarType": "google",
  "accessToken": "ya29.a0AfH6SMBx...",
  "startDate": "2023-01-01T00:00:00.000Z",
  "endDate": "2023-01-31T23:59:59.999Z"
}
```
- **Notes**:
  - `calendarType` can be one of: `google`, `outlook`, `apple`
- **Success Response**: `201 Created`
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "_id": "60d21b4667d0d8992e610c85",
      "user": "60d21b4667d0d8992e610c85",
      "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
      "status": "meeting",
      "customStatus": "Team Standup",
      "startTime": "2023-01-02T09:00:00.000Z",
      "endTime": "2023-01-02T09:30:00.000Z",
      "repeat": "weekly",
      "active": true
    },
    ...
  ]
}
```

### Get Status Suggestions
- **URL**: `/api/bulk/suggestions`
- **Method**: `GET`
- **Auth required**: Yes
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "name": "Morning Meeting",
      "status": "meeting",
      "customStatus": "Daily Standup",
      "startTime": "09:00",
      "endTime": "09:30",
      "repeat": "weekdays",
      "confidence": 0.85
    },
    ...
  ]
}
```

## Contact Status APIs

These APIs allow you to retrieve the current status of contacts in your contact list.

### Get All Contacts with Status

**Endpoint:** `GET /api/contacts/with-status`

**Authentication:** JWT token required

**Description:** Returns all contacts in the authenticated user's contact list with their current status information.

**Response:**
```json
[
  {
    "_id": "60d21b4667d0d8992e610c85",
    "userId": "user123",
    "name": "John Doe",
    "email": "john@example.com",
    "phoneNumber": "1234567890",
    "profileImage": "https://example.com/profile.jpg",
    "currentStatus": {
      "status": "busy",
      "customStatus": "",
      "statusUntil": "2023-07-15T15:30:00.000Z"
    }
  },
  {
    "_id": "60d21b4667d0d8992e610c86",
    "userId": "user456",
    "name": "Jane Smith",
    "email": "jane@example.com",
    "phoneNumber": "0987654321",
    "profileImage": "https://example.com/jane.jpg",
    "currentStatus": {
      "status": "custom",
      "customStatus": "In a meeting",
      "statusUntil": null
    }
  }
]
```

### Get Status of a Specific Contact

**Endpoint:** `GET /api/contacts/:id/status`

**Authentication:** JWT token required

**Parameters:**
- `id`: MongoDB ObjectId of the contact

**Description:** Returns the current status of a specific contact in the authenticated user's contact list.

**Response:**
```json
{
  "status": "busy",
  "customStatus": "",
  "statusUntil": "2023-07-15T15:30:00.000Z"
}
```

### Get Status by Phone Number

**Endpoint:** `GET /api/contacts/phone/:phoneNumber/status`

**Authentication:** JWT token required

**Parameters:**
- `phoneNumber`: Phone number of the user to get status for

**Description:** Returns the status of a user by their phone number. The phone number will be normalized to handle different formats.

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user123",
    "name": "John Doe",
    "status": "busy",
    "customStatus": "",
    "statusUntil": "2023-07-15T15:30:00.000Z"
  }
}
```

### Filter Contacts by Phone Numbers

**Endpoint:** `POST /api/contacts/filter`

**Authentication:** JWT token required

**Request Body:**
```json
{
  "phoneNumbers": ["1234567890", "0987654321"]
}
```

**Description:** Returns registered users matching the provided phone numbers, along with their status information.

**Response:**
```json
{
  "success": true,
  "users": [
    {
      "_id": "60d21b4667d0d8992e610c85",
      "userId": "user123",
      "name": "John Doe",
      "phoneNumber": "1234567890",
      "email": "john@example.com",
      "profileImage": "https://example.com/profile.jpg",
      "status": "busy",
      "customStatus": "",
      "statusUntil": "2023-07-15T15:30:00.000Z"
    }
  ],
  "debug": {
    "originalPhoneNumbers": ["1234567890", "0987654321"]
  }
}
```

### Get Status for a List of Contacts

**Endpoint:** `POST /api/contacts/status-list`

**Authentication:** JWT token required

**Description:** Returns the status information for a list of contact IDs provided in the request body. This endpoint accepts both MongoDB ObjectIds and UUIDs.

**Request Body:**
```json
{
  "contactIds": ["60d21b4667d0d8992e610c85", "user123", "user456"]
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "60d21b4667d0d8992e610c85",
      "userId": "user123",
      "name": "John Doe",
      "email": "john@example.com",
      "phoneNumber": "1234567890",
      "profileImage": "https://example.com/profile.jpg",
      "status": "busy",
      "customStatus": "In a meeting",
      "statusUntil": "2023-07-15T15:30:00.000Z"
    },
    {
      "_id": "60d21b4667d0d8992e610c86",
      "userId": "user456",
      "name": "Jane Smith",
      "email": "jane@example.com",
      "phoneNumber": "0987654321",
      "profileImage": "https://example.com/jane-profile.jpg",
      "status": "available",
      "customStatus": "",
      "statusUntil": null
    }
  ]
}
```

## Real-Time Status Updates

The application supports real-time status updates via Socket.IO. When a user updates their status, all users who have that user in their contacts list will receive a real-time update.

### Socket.IO Connection

**Connection URL:** `http://your-api-domain`

**Authentication:** JWT token required

**Example (JavaScript):**
```javascript
import { io } from "socket.io-client";

const socket = io("http://your-api-domain", {
  auth: {
    token: "your-jwt-token"
  }
});

socket.on("connect", () => {
  console.log("Connected to Socket.IO server");
});

socket.on("connect_error", (error) => {
  console.error("Socket.IO connection error:", error.message);
});
```

### Initial Status Data

**Event:** `contacts_status_initial`

**Description:** Emitted when a user connects to Socket.IO, providing the current status of all contacts in their contact list.

**Event Data:**
```json
[
  {
    "contactId": "60d21b4667d0d8992e610c85",
    "userId": "user123",
    "name": "John Doe",
    "status": "busy",
    "customStatus": "",
    "statusUntil": "2023-07-15T15:30:00.000Z"
  },
  {
    "contactId": "60d21b4667d0d8992e610c86",
    "userId": "user456",
    "name": "Jane Smith",
    "status": "custom",
    "customStatus": "In a meeting",
    "statusUntil": null
  }
]
```

**Example (JavaScript):**
```javascript
socket.on("contacts_status_initial", (contactsData) => {
  console.log("Received initial contacts status:", contactsData);
  
  // Update contacts with initial status data
  setContacts(prevContacts => {
    return prevContacts.map(contact => {
      const matchingContact = contactsData.find(c => c.contactId === contact._id);
      if (matchingContact) {
        return {
          ...contact,
          currentStatus: {
            status: matchingContact.status,
            customStatus: matchingContact.customStatus,
            statusUntil: matchingContact.statusUntil
          }
        };
      }
      return contact;
    });
  });
});
```

### Real-Time Status Update Event

**Event:** `contact_status_update`

**Description:** Emitted when a contact in the user's contact list updates their status.

**Event Data:**
```json
{
  "contactId": "60d21b4667d0d8992e610c85",
  "userId": "user123",
  "name": "John Doe",
  "status": "busy",
  "customStatus": "",
  "statusUntil": "2023-07-15T15:30:00.000Z",
  "timestamp": "2023-07-15T14:30:00.000Z"
}
```

**Example (JavaScript):**
```javascript
socket.on("contact_status_update", (data) => {
  console.log(`Contact ${data.name} updated status to ${data.status}`);
  
  // Update the contact's status in the state
  setContacts(prevContacts => {
    return prevContacts.map(contact => {
      if (contact._id === data.contactId) {
        return {
          ...contact,
          currentStatus: {
            status: data.status,
            customStatus: data.customStatus,
            statusUntil: data.statusUntil
          }
        };
      }
      return contact;
    });
  });
});
```

### Updating Contacts List

**Event:** `update_contacts`

**Description:** Emit this event when the user adds or removes contacts to refresh the contacts cache on the server.

**Example (JavaScript):**
```javascript
// After adding or removing a contact
function afterContactListChange() {
  socket.emit("update_contacts");
}
```

### Example React Client Implementation

Here's an example of how to implement status retrieval and real-time updates in a React client:

```jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const ContactsList = () => {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [socket, setSocket] = useState(null);
  
  useEffect(() => {
    // Get JWT token from local storage or auth context
    const token = localStorage.getItem('token');
    
    // Initialize socket connection
    const socketInstance = io('http://your-api-domain', {
      auth: {
        token
      }
    });
    
    setSocket(socketInstance);
    
    // Fetch contacts with status
    const fetchContacts = async () => {
      try {
        const response = await axios.get('http://your-api-domain/api/contacts/with-status', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        setContacts(response.data);
        setLoading(false);
      } catch (err) {
        setError('Error fetching contacts');
        setLoading(false);
      }
    };
    
    fetchContacts();
    
    // Socket event handlers
    socketInstance.on('connect', () => {
      console.log('Connected to Socket.IO server');
    });
    
    socketInstance.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
    });
    
    // Handle initial contacts status data
    socketInstance.on('contacts_status_initial', (contactsData) => {
      console.log('Received initial contacts status:', contactsData);
      
      // Update contacts with initial status data
      setContacts(prevContacts => {
        return prevContacts.map(contact => {
          const matchingContact = contactsData.find(c => c.contactId === contact._id);
          if (matchingContact) {
            return {
              ...contact,
              currentStatus: {
                status: matchingContact.status,
                customStatus: matchingContact.customStatus,
                statusUntil: matchingContact.statusUntil
              }
            };
          }
          return contact;
        });
      });
    });
    
    // Listen for real-time status updates
    socketInstance.on('contact_status_update', (data) => {
      console.log('Received status update:', data);
      
      // Update the contact's status in the state
      setContacts(prevContacts => {
        return prevContacts.map(contact => {
          if (contact._id === data.contactId) {
            return {
              ...contact,
              currentStatus: {
                status: data.status,
                customStatus: data.customStatus,
                statusUntil: data.statusUntil
              }
            };
          }
          return contact;
        });
      });
    });
    
    // Clean up on unmount
    return () => {
      socketInstance.disconnect();
    };
  }, []);
  
  // Function to handle adding a new contact
  const handleAddContact = async (contactData) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post('http://your-api-domain/api/contacts', contactData, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      // Notify server to update contacts cache
      if (socket) {
        socket.emit('update_contacts');
      }
      
      // Refresh contacts list
      const response = await axios.get('http://your-api-domain/api/contacts/with-status', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      setContacts(response.data);
    } catch (err) {
      console.error('Error adding contact:', err);
    }
  };
  
  // Function to check status by phone number
  const checkStatusByPhone = async (phoneNumber) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`http://your-api-domain/api/contacts/phone/${phoneNumber}/status`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      return response.data;
    } catch (err) {
      console.error('Error checking status by phone:', err);
      return null;
    }
  };
  
  if (loading) return <div>Loading contacts...</div>;
  if (error) return <div>{error}</div>;
  
  return (
    <div className="contacts-list">
      <h2>My Contacts</h2>
      {contacts.length === 0 ? (
        <p>No contacts found</p>
      ) : (
        <ul>
          {contacts.map(contact => (
            <li key={contact._id} className="contact-item">
              <div className="contact-info">
                <img 
                  src={contact.profileImage || 'default-avatar.png'} 
                  alt={contact.name} 
                  className="contact-avatar"
                />
                <div>
                  <h3>{contact.name}</h3>
                  <p>{contact.phoneNumber}</p>
                </div>
              </div>
              <div className="contact-status">
                <div className={`status-indicator ${contact.currentStatus.status}`}></div>
                <div className="status-text">
                  {contact.currentStatus.status === 'custom' 
                    ? contact.currentStatus.customStatus 
                    : contact.currentStatus.status.replace('_', ' ')}
                </div>
                {contact.currentStatus.statusUntil && (
                  <div className="status-expiry">
                    Until {new Date(contact.currentStatus.statusUntil).toLocaleTimeString()}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ContactsList;
