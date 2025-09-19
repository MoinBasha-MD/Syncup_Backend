# RightView Backend API Documentation

## Overview

RightView is a status management application that allows users to set, schedule, and manage their availability status. This backend API provides all the necessary endpoints for user authentication, status management, scheduling, and analytics.

## Table of Contents

- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
  - [Authentication](#authentication)
  - [User Management](#user-management)
  - [Status Management](#status-management)
  - [Status Templates](#status-templates)
  - [Status Schedules](#status-schedules)
  - [Status History](#status-history)
  - [Bulk Operations](#bulk-operations)
  - [Status Suggestions](#status-suggestions)
  - [Calendar Integration](#calendar-integration)
- [Data Models](#data-models)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)
- [Security](#security)
- [Caching](#caching)
- [Pagination](#pagination)

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- MongoDB (v4.4 or higher)
- Redis (v6 or higher) - Optional for caching

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/rightview-backend.git
cd rightview-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables (see [Environment Variables](#environment-variables) section)

4. Start the server:
```bash
# Development mode
npm run dev

# Production mode
npm start
```

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```
# Server Configuration
PORT=5000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000,http://yourdomain.com

# Database Configuration
MONGO_URI=mongodb://localhost:27017/rightview

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Authentication
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRE=30d

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
AUTH_RATE_LIMIT_MAX_REQUESTS=10

# Logging
LOG_LEVEL=error
```

## API Endpoints

All API endpoints are prefixed with `/api`. The API uses JWT for authentication. Include the JWT token in the Authorization header for protected routes:

```
Authorization: Bearer <your_jwt_token>
```

### Authentication

#### Register a new user

- **URL**: `/api/users`
- **Method**: `POST`
- **Auth required**: No
- **Rate limit**: 10 requests per 15 minutes
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
  "_id": "60d21b4667d0d8992e610c85",
  "name": "John Doe",
  "phoneNumber": "1234567890",
  "email": "john@example.com",
  "status": "available",
  "customStatus": "",
  "statusUntil": null,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```
- **Error Response**: `400 Bad Request`
```json
{
  "success": false,
  "message": "User with this email already exists",
  "error": "ValidationError"
}
```

#### Login user

- **URL**: `/api/users/login`
- **Method**: `POST`
- **Auth required**: No
- **Rate limit**: 10 requests per 15 minutes
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
  "_id": "60d21b4667d0d8992e610c85",
  "name": "John Doe",
  "phoneNumber": "1234567890",
  "email": "john@example.com",
  "status": "available",
  "customStatus": "",
  "statusUntil": null,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```
- **Error Response**: `401 Unauthorized`
```json
{
  "success": false,
  "message": "Invalid phone number or password",
  "error": "UnauthorizedError"
}
```

### User Management

#### Get user profile

- **URL**: `/api/users/profile`
- **Method**: `GET`
- **Auth required**: Yes
- **Success Response**: `200 OK`
```json
{
  "_id": "60d21b4667d0d8992e610c85",
  "name": "John Doe",
  "phoneNumber": "1234567890",
  "email": "john@example.com",
  "status": "available",
  "customStatus": "",
  "statusUntil": null
}
```

#### Update user profile

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
  "name": "John Smith",
  "phoneNumber": "0987654321",
  "email": "john.smith@example.com",
  "status": "available",
  "customStatus": "",
  "statusUntil": null,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Status Management

#### Update user status

- **URL**: `/api/users/status` or `/api/status`
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
  "_id": "60d21b4667d0d8992e610c85",
  "name": "John Doe",
  "phoneNumber": "1234567890",
  "email": "john@example.com",
  "status": "busy",
  "customStatus": "In a meeting",
  "statusUntil": "2025-05-26T11:49:30.000Z"
}
```

### Status Templates

#### Get status templates

- **URL**: `/api/status/templates`
- **Method**: `GET`
- **Auth required**: Yes
- **Query parameters**:
  - `page` (optional): Page number (default: 1)
  - `limit` (optional): Items per page (default: 10)
- **Success Response**: `200 OK`
```json
{
  "templates": [
    {
      "_id": "60d21b4667d0d8992e610c86",
      "user": "60d21b4667d0d8992e610c85",
      "name": "Meeting",
      "status": "meeting",
      "customStatus": "",
      "duration": 60,
      "createdAt": "2025-05-26T10:00:00.000Z",
      "updatedAt": "2025-05-26T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "pages": 1
  }
}
```

#### Create status template

- **URL**: `/api/status/templates`
- **Method**: `POST`
- **Auth required**: Yes
- **Request body**:
```json
{
  "name": "Lunch Break",
  "status": "eating",
  "customStatus": "",
  "duration": 45
}
```
- **Success Response**: `201 Created`
```json
{
  "_id": "60d21b4667d0d8992e610c87",
  "user": "60d21b4667d0d8992e610c85",
  "name": "Lunch Break",
  "status": "eating",
  "customStatus": "",
  "duration": 45,
  "createdAt": "2025-05-26T10:30:00.000Z",
  "updatedAt": "2025-05-26T10:30:00.000Z"
}
```

#### Update status template

- **URL**: `/api/status/templates/:id`
- **Method**: `PUT`
- **Auth required**: Yes
- **URL Parameters**: `id` - Template ID
- **Request body**:
```json
{
  "name": "Extended Lunch",
  "duration": 60
}
```
- **Success Response**: `200 OK`
```json
{
  "_id": "60d21b4667d0d8992e610c87",
  "user": "60d21b4667d0d8992e610c85",
  "name": "Extended Lunch",
  "status": "eating",
  "customStatus": "",
  "duration": 60,
  "createdAt": "2025-05-26T10:30:00.000Z",
  "updatedAt": "2025-05-26T10:45:00.000Z"
}
```

#### Delete status template

- **URL**: `/api/status/templates/:id`
- **Method**: `DELETE`
- **Auth required**: Yes
- **URL Parameters**: `id` - Template ID
- **Success Response**: `200 OK`
```json
{
  "message": "Status template removed"
}
```

### Status Schedules

#### Get status schedules

- **URL**: `/api/status/schedules`
- **Method**: `GET`
- **Auth required**: Yes
- **Query parameters**:
  - `page` (optional): Page number (default: 1)
  - `limit` (optional): Items per page (default: 10)
- **Success Response**: `200 OK`
```json
{
  "schedules": [
    {
      "_id": "60d21b4667d0d8992e610c88",
      "user": "60d21b4667d0d8992e610c85",
      "status": "meeting",
      "customStatus": "Team Standup",
      "startTime": "2025-05-27T09:00:00.000Z",
      "endTime": "2025-05-27T09:30:00.000Z",
      "repeat": "weekdays",
      "active": true,
      "createdAt": "2025-05-26T11:00:00.000Z",
      "updatedAt": "2025-05-26T11:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "pages": 1
  }
}
```

#### Create status schedule

- **URL**: `/api/status/schedules`
- **Method**: `POST`
- **Auth required**: Yes
- **Request body**:
```json
{
  "status": "meeting",
  "customStatus": "Team Standup",
  "startTime": "2025-05-27T09:00:00.000Z",
  "endTime": "2025-05-27T09:30:00.000Z",
  "repeat": "weekdays"
}
```
- **Notes**:
  - `repeat` can be one of: `none`, `daily`, `weekdays`, `weekly`, `monthly`
- **Success Response**: `201 Created`
```json
{
  "_id": "60d21b4667d0d8992e610c88",
  "user": "60d21b4667d0d8992e610c85",
  "status": "meeting",
  "customStatus": "Team Standup",
  "startTime": "2025-05-27T09:00:00.000Z",
  "endTime": "2025-05-27T09:30:00.000Z",
  "repeat": "weekdays",
  "active": true,
  "createdAt": "2025-05-26T11:00:00.000Z",
  "updatedAt": "2025-05-26T11:00:00.000Z"
}
```

#### Update status schedule

- **URL**: `/api/status/schedules/:id`
- **Method**: `PUT`
- **Auth required**: Yes
- **URL Parameters**: `id` - Schedule ID
- **Request body**:
```json
{
  "customStatus": "Daily Standup",
  "active": true
}
```
- **Success Response**: `200 OK`
```json
{
  "_id": "60d21b4667d0d8992e610c88",
  "user": "60d21b4667d0d8992e610c85",
  "status": "meeting",
  "customStatus": "Daily Standup",
  "startTime": "2025-05-27T09:00:00.000Z",
  "endTime": "2025-05-27T09:30:00.000Z",
  "repeat": "weekdays",
  "active": true,
  "createdAt": "2025-05-26T11:00:00.000Z",
  "updatedAt": "2025-05-26T11:15:00.000Z"
}
```

#### Delete status schedule

- **URL**: `/api/status/schedules/:id`
- **Method**: `DELETE`
- **Auth required**: Yes
- **URL Parameters**: `id` - Schedule ID
- **Success Response**: `200 OK`
```json
{
  "message": "Status schedule removed"
}
```

#### Get upcoming status schedules

- **URL**: `/api/status/schedules/upcoming`
- **Method**: `GET`
- **Auth required**: Yes
- **Success Response**: `200 OK`
```json
[
  {
    "_id": "60d21b4667d0d8992e610c88",
    "user": "60d21b4667d0d8992e610c85",
    "status": "meeting",
    "customStatus": "Daily Standup",
    "startTime": "2025-05-27T09:00:00.000Z",
    "endTime": "2025-05-27T09:30:00.000Z",
    "repeat": "weekdays",
    "active": true,
    "createdAt": "2025-05-26T11:00:00.000Z",
    "updatedAt": "2025-05-26T11:15:00.000Z"
  }
]
```

### Status History

#### Get status history

- **URL**: `/api/status/history`
- **Method**: `GET`
- **Auth required**: Yes
- **Query parameters**:
  - `page` (optional): Page number (default: 1)
  - `limit` (optional): Items per page (default: 10)
  - `startDate` (optional): Filter by start date (ISO format)
  - `endDate` (optional): Filter by end date (ISO format)
- **Success Response**: `200 OK`
```json
{
  "history": [
    {
      "_id": "60d21b4667d0d8992e610c89",
      "user": "60d21b4667d0d8992e610c85",
      "status": "meeting",
      "customStatus": "Team Meeting",
      "startTime": "2025-05-26T10:00:00.000Z",
      "endTime": "2025-05-26T11:00:00.000Z",
      "duration": 60,
      "createdAt": "2025-05-26T11:00:00.000Z",
      "updatedAt": "2025-05-26T11:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "pages": 1
  }
}
```

#### Create status history entry

- **URL**: `/api/status/history`
- **Method**: `POST`
- **Auth required**: Yes
- **Request body**:
```json
{
  "status": "meeting",
  "customStatus": "Team Meeting",
  "startTime": "2025-05-26T10:00:00.000Z",
  "endTime": "2025-05-26T11:00:00.000Z"
}
```
- **Success Response**: `201 Created`
```json
{
  "_id": "60d21b4667d0d8992e610c89",
  "user": "60d21b4667d0d8992e610c85",
  "status": "meeting",
  "customStatus": "Team Meeting",
  "startTime": "2025-05-26T10:00:00.000Z",
  "endTime": "2025-05-26T11:00:00.000Z",
  "duration": 60,
  "createdAt": "2025-05-26T11:00:00.000Z",
  "updatedAt": "2025-05-26T11:00:00.000Z"
}
```

#### Delete status history entry

- **URL**: `/api/status/history/:id`
- **Method**: `DELETE`
- **Auth required**: Yes
- **URL Parameters**: `id` - History ID
- **Success Response**: `200 OK`
```json
{
  "message": "Status history removed"
}
```

#### Get status analytics

- **URL**: `/api/status/history/analytics`
- **Method**: `GET`
- **Auth required**: Yes
- **Query parameters**:
  - `startDate` (optional): Filter by start date (ISO format)
  - `endDate` (optional): Filter by end date (ISO format)
- **Success Response**: `200 OK`
```json
{
  "totalEntries": 10,
  "totalDuration": 480,
  "statusDurations": {
    "meeting": 120,
    "busy": 180,
    "available": 180
  },
  "statusPercentages": {
    "meeting": 25,
    "busy": 37,
    "available": 38
  },
  "mostFrequentStatus": "available",
  "suggestions": {
    "morning": "meeting",
    "afternoon": "busy",
    "evening": "available"
  }
}
```

### Bulk Operations

#### Bulk create status templates

- **URL**: `/api/bulk/templates/bulk`
- **Method**: `POST`
- **Auth required**: Yes
- **Request body**:
```json
[
  {
    "name": "Meeting",
    "status": "meeting",
    "customStatus": "",
    "duration": 60
  },
  {
    "name": "Lunch",
    "status": "eating",
    "customStatus": "",
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
      "_id": "60d21b4667d0d8992e610c8a",
      "user": "60d21b4667d0d8992e610c85",
      "name": "Meeting",
      "status": "meeting",
      "customStatus": "",
      "duration": 60,
      "createdAt": "2025-05-26T12:00:00.000Z",
      "updatedAt": "2025-05-26T12:00:00.000Z"
    },
    {
      "_id": "60d21b4667d0d8992e610c8b",
      "user": "60d21b4667d0d8992e610c85",
      "name": "Lunch",
      "status": "eating",
      "customStatus": "",
      "duration": 45,
      "createdAt": "2025-05-26T12:00:00.000Z",
      "updatedAt": "2025-05-26T12:00:00.000Z"
    }
  ]
}
```

#### Bulk create status schedules

- **URL**: `/api/bulk/schedules/bulk`
- **Method**: `POST`
- **Auth required**: Yes
- **Request body**:
```json
[
  {
    "status": "meeting",
    "customStatus": "Team Standup",
    "startTime": "2025-05-27T09:00:00.000Z",
    "endTime": "2025-05-27T09:30:00.000Z",
    "repeat": "weekdays"
  },
  {
    "status": "eating",
    "customStatus": "Lunch Break",
    "startTime": "2025-05-27T12:00:00.000Z",
    "endTime": "2025-05-27T13:00:00.000Z",
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
      "_id": "60d21b4667d0d8992e610c8c",
      "user": "60d21b4667d0d8992e610c85",
      "status": "meeting",
      "customStatus": "Team Standup",
      "startTime": "2025-05-27T09:00:00.000Z",
      "endTime": "2025-05-27T09:30:00.000Z",
      "repeat": "weekdays",
      "active": true,
      "createdAt": "2025-05-26T12:15:00.000Z",
      "updatedAt": "2025-05-26T12:15:00.000Z"
    },
    {
      "_id": "60d21b4667d0d8992e610c8d",
      "user": "60d21b4667d0d8992e610c85",
      "status": "eating",
      "customStatus": "Lunch Break",
      "startTime": "2025-05-27T12:00:00.000Z",
      "endTime": "2025-05-27T13:00:00.000Z",
      "repeat": "weekdays",
      "active": true,
      "createdAt": "2025-05-26T12:15:00.000Z",
      "updatedAt": "2025-05-26T12:15:00.000Z"
    }
  ]
}
```

### Status Suggestions

#### Get status suggestions

- **URL**: `/api/bulk/suggestions`
- **Method**: `GET`
- **Auth required**: Yes
- **Success Response**: `200 OK`
```json
{
  "success": true,
  "data": {
    "suggestions": [
      {
        "status": "meeting",
        "confidence": 0.75,
        "reasons": [
          "You're usually meeting at this time of day",
          "You're often meeting on Mondays"
        ],
        "duration": 60
      },
      {
        "status": "eating",
        "confidence": 0.65,
        "reasons": [
          "You typically stay eating for about 45 minutes"
        ],
        "duration": 45
      }
    ],
    "confidence": 0.75,
    "message": "Suggestions based on your usage patterns"
  }
}
```

### Calendar Integration

#### Sync with calendar

- **URL**: `/api/bulk/sync/calendar`
- **Method**: `POST`
- **Auth required**: Yes
- **Request body**:
```json
{
  "calendarType": "google",
  "accessToken": "your_oauth_access_token",
  "startDate": "2025-05-26T00:00:00.000Z",
  "endDate": "2025-06-02T23:59:59.000Z"
}
```
- **Notes**:
  - `calendarType` can be one of: `google`, `outlook`, `apple`
- **Success Response**: `201 Created`
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "_id": "60d21b4667d0d8992e610c8e",
      "user": "60d21b4667d0d8992e610c85",
      "status": "meeting",
      "customStatus": "Team Meeting",
      "startTime": "2025-05-27T10:00:00.000Z",
      "endTime": "2025-05-27T11:00:00.000Z",
      "repeat": "none",
      "active": true,
      "createdAt": "2025-05-26T12:30:00.000Z",
      "updatedAt": "2025-05-26T12:30:00.000Z"
    },
    {
      "_id": "60d21b4667d0d8992e610c8f",
      "user": "60d21b4667d0d8992e610c85",
      "status": "eating",
      "customStatus": "",
      "startTime": "2025-05-27T13:00:00.000Z",
      "endTime": "2025-05-27T14:00:00.000Z",
      "repeat": "none",
      "active": true,
      "createdAt": "2025-05-26T12:30:00.000Z",
      "updatedAt": "2025-05-26T12:30:00.000Z"
    },
    {
      "_id": "60d21b4667d0d8992e610c90",
      "user": "60d21b4667d0d8992e610c85",
      "status": "meeting",
      "customStatus": "Weekly Planning",
      "startTime": "2025-05-28T09:00:00.000Z",
      "endTime": "2025-05-28T10:00:00.000Z",
      "repeat": "weekly",
      "active": true,
      "createdAt": "2025-05-26T12:30:00.000Z",
      "updatedAt": "2025-05-26T12:30:00.000Z"
    }
  ]
}
```

## Data Models

### User

```json
{
  "_id": "ObjectId",
  "name": "String",
  "phoneNumber": "String",
  "email": "String",
  "password": "String (hashed)",
  "status": "String",
  "customStatus": "String",
  "statusUntil": "Date",
  "resetPasswordToken": "String",
  "resetPasswordExpire": "Date",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### Status Template

```json
{
  "_id": "ObjectId",
  "user": "ObjectId (ref: User)",
  "name": "String",
  "status": "String",
  "customStatus": "String",
  "duration": "Number (minutes)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### Status Schedule

```json
{
  "_id": "ObjectId",
  "user": "ObjectId (ref: User)",
  "status": "String",
  "customStatus": "String",
  "startTime": "Date",
  "endTime": "Date",
  "repeat": "String",
  "active": "Boolean",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### Status History

```json
{
  "_id": "ObjectId",
  "user": "ObjectId (ref: User)",
  "status": "String",
  "customStatus": "String",
  "startTime": "Date",
  "endTime": "Date",
  "duration": "Number (minutes)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

## Error Handling

The API uses a standardized error response format:

```json
{
  "success": false,
  "message": "Error message",
  "error": "ErrorType",
  "stack": "Error stack trace (only in development mode)"
}
```

Common error types:
- `ValidationError`: Request validation failed
- `UnauthorizedError`: Authentication required
- `ForbiddenError`: Insufficient permissions
- `NotFoundError`: Resource not found
- `DuplicateKeyError`: Unique constraint violation
- `RateLimitError`: Too many requests

## Rate Limiting

The API implements rate limiting to prevent abuse:

- General API endpoints: 100 requests per 15 minutes
- Authentication endpoints: 10 requests per 15 minutes

When a rate limit is exceeded, the API returns a `429 Too Many Requests` response:

```json
{
  "success": false,
  "message": "Too many requests, please try again after 15 minutes",
  "error": "RateLimitError"
}
```

## Security

The API implements several security measures:

- JWT-based authentication
- Password hashing with bcrypt
- HTTPS in production
- Security headers (via helmet.js)
- CORS protection
- Request validation
- Rate limiting

## Caching

The API uses Redis for caching frequently accessed data:

- Status templates: 1 hour cache
- Status schedules: 1 hour cache
- Status history: 1 hour cache
- Status suggestions: 5 minutes cache

Cache is automatically invalidated when related data is modified.

## Pagination

Endpoints that return lists of data support pagination:

- Query parameters:
  - `page`: Page number (default: 1)
  - `limit`: Items per page (default: 10)

- Response format:
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "pages": 10
  }
}
```

## License

This project is licensed under the ISC License.
