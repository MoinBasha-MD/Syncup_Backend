# Essential API Documentation

## 1. Authentication APIs

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

## 2. User Management APIs

### Get User Data
- **URL**: `/api/users/:userId`
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
    "updatedAt": "2023-01-01T00:00:00.000Z",
    "recentHistory": [...],
    "activeSchedules": [...],
    "templates": [...]
  }
}
```

### Update User Profile
- **URL**: `/api/users/:userId`
- **Method**: `PUT`
- **Auth required**: Yes
- **URL Parameters**: `userId=[UUID]`
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
  "success": true,
  "data": {
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "name": "John Smith",
    "phoneNumber": "0987654321",
    "email": "john.smith@example.com",
    "status": "available",
    "customStatus": "",
    "statusUntil": null
  }
}
```

## 3. Status Management APIs

### Get Current User Status
- **URL**: `/api/status`
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
- **URL**: `/api/status`
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

### Get User Status by Phone Number
- **URL**: `/api/status-management/phone/:phoneNumber`
- **Method**: `GET`
- **Auth required**: Yes
- **URL Parameters**: `phoneNumber=[String]`
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "phoneNumber": "1234567890",
    "status": "busy",
    "customStatus": "In a meeting",
    "statusUntil": "2023-01-01T01:00:00.000Z"
  }
}
```

## 4. Status History APIs

### Get User Status History
- **URL**: `/api/status/history`
- **Method**: `GET`
- **Auth required**: Yes
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

## 5. Status Templates APIs

### Get User Status Templates
- **URL**: `/api/status/templates`
- **Method**: `GET`
- **Auth required**: Yes
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
  "success": true,
  "data": {
    "_id": "60d21b4667d0d8992e610c85",
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "name": "Meeting",
    "status": "busy",
    "customStatus": "In a meeting",
    "duration": 60
  }
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
  "success": true,
  "data": {
    "_id": "60d21b4667d0d8992e610c85",
    "userId": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
    "name": "Long Meeting",
    "status": "busy",
    "customStatus": "In an important meeting",
    "duration": 120
  }
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

## 6. Status Schedules APIs

### Get User Status Schedules
- **URL**: `/api/status/schedules`
- **Method**: `GET`
- **Auth required**: Yes
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
- **URL**: `/api/status/schedules`
- **Method**: `POST`
- **Auth required**: Yes
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
- **URL**: `/api/status/schedules/:id`
- **Method**: `PUT`
- **Auth required**: Yes
- **URL Parameters**: `id=[MongoDB ObjectId]`
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
- **URL**: `/api/status/schedules/:id`
- **Method**: `DELETE`
- **Auth required**: Yes
- **URL Parameters**: `id=[MongoDB ObjectId]`
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

## 7. Contact Management APIs

### Get All Contacts with Status
- **URL**: `/api/contacts`
- **Method**: `GET`
- **Auth required**: Yes
- **Success Response**: `200 OK`
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
      "currentStatus": {
        "status": "busy",
        "customStatus": "",
        "statusUntil": "2023-07-15T15:30:00.000Z"
      }
    },
    ...
  ]
}
```

### Get Status of a Specific Contact
- **URL**: `/api/contacts/:id`
- **Method**: `GET`
- **Auth required**: Yes
- **URL Parameters**: `id=[MongoDB ObjectId]`
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": {
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
  }
}
```

### Filter Contacts by Phone Numbers
- **URL**: `/api/contacts/filter`
- **Method**: `POST`
- **Auth required**: Yes
- **Request Body**:
```json
{
  "phoneNumbers": ["1234567890", "0987654321"]
}
```
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": [
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
  ]
}
```

## 8. Real-Time Status Updates (Socket.IO)

The application supports real-time status updates via Socket.IO. When a user updates their status, all users who have that user in their contacts list will receive a real-time update.

### Socket.IO Connection
- **Connection URL**: `http://your-api-domain`
- **Authentication**: JWT token required

### Events
- **contacts_status_initial**: Emitted when a user connects to Socket.IO, providing the current status of all contacts in their contact list.
- **contact_status_update**: Emitted when a contact in the user's contact list updates their status.
- **update_contacts**: Emit this event when the user adds or removes contacts to refresh the contacts cache on the server.
