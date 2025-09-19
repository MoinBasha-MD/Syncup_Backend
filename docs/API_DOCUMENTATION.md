# Syncup Backend API Documentation

## Overview
This document provides comprehensive documentation for the Syncup Backend API, including all endpoints, authentication, error handling, and best practices.

## Base URL
- **Development**: `http://localhost:3000`
- **Production**: `https://your-domain.com`

## API Versioning
The API supports versioning through multiple methods:

### 1. URL Path (Recommended)
```
GET /api/v1/users
GET /api/v2/users
```

### 2. Custom Header
```
X-API-Version: 1
```

### 3. Accept Header
```
Accept: application/vnd.api+json;version=1
```

**Supported Versions**: 1, 2  
**Default Version**: 1

## Authentication
All protected endpoints require JWT authentication.

### Headers
```
Authorization: Bearer <jwt_token>
```

### Token Structure
```json
{
  "id": "user_mongodb_id",
  "userId": "user_custom_id",
  "iat": 1234567890,
  "exp": 1234567890
}
```

## Health Check & Monitoring

### Health Check
**GET** `/health`

Returns comprehensive system health information.

**Response (200 OK)**:
```json
{
  "status": "UP",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "environment": "production",
  "uptime": 3600,
  "checks": {
    "database": {
      "status": "UP",
      "state": "connected",
      "responseTime": "5.23ms",
      "ping": "2.15ms"
    },
    "memory": {
      "status": "UP",
      "usage": {
        "rss": "45MB",
        "heapTotal": "30MB",
        "heapUsed": "25MB",
        "external": "2MB"
      },
      "heapUsedPercentage": "83.33%"
    },
    "cpu": {
      "status": "UP",
      "usage": {
        "user": "1500.25ms",
        "system": "800.50ms"
      }
    },
    "environment": {
      "status": "UP",
      "required": ["MONGO_URI", "JWT_SECRET"],
      "missing": []
    }
  },
  "responseTime": "12.45ms"
}
```

### Liveness Probe
**GET** `/health/live`

Simple endpoint to check if the service is alive.

### Readiness Probe
**GET** `/health/ready`

Checks if the service is ready to accept requests.

### Metrics
**GET** `/metrics`

Returns detailed system metrics for monitoring.

## Rate Limiting

Different endpoints have different rate limits:

- **Authentication**: 5 requests per 15 minutes per IP
- **API Endpoints**: 100 requests per 15 minutes per IP
- **Status Updates**: 10 requests per minute per user
- **User Data**: 50 requests per 15 minutes per user

## Security Features

### Input Sanitization
- **NoSQL Injection Protection**: All inputs are sanitized against NoSQL injection attacks
- **XSS Protection**: User inputs are sanitized to prevent XSS attacks
- **HTTP Parameter Pollution**: Protection against parameter pollution attacks

### Security Headers
- **Helmet**: Comprehensive security headers
- **CORS**: Configurable cross-origin resource sharing
- **Content Security Policy**: Strict CSP headers

### Request Size Limits
- **JSON Payload**: 10MB maximum
- **URL Encoded**: 10MB maximum
- **File Uploads**: Configured per endpoint

## API Endpoints

### Authentication Endpoints

#### Register User
**POST** `/api/auth/register`

**Request Body**:
```json
{
  "userId": "unique_user_id",
  "name": "User Name",
  "email": "user@example.com",
  "password": "secure_password"
}
```

**Response (201 Created)**:
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": "mongodb_id",
      "userId": "unique_user_id",
      "name": "User Name",
      "email": "user@example.com"
    },
    "token": "jwt_token_here"
  }
}
```

#### Login User
**POST** `/api/auth/login`

**Request Body**:
```json
{
  "userId": "unique_user_id",
  "password": "secure_password"
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "mongodb_id",
      "userId": "unique_user_id",
      "name": "User Name",
      "email": "user@example.com"
    },
    "token": "jwt_token_here"
  }
}
```

#### Check User Existence
**POST** `/api/auth/check-user`

**Request Body**:
```json
{
  "userId": "unique_user_id"
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "exists": true,
  "data": {
    "userId": "unique_user_id",
    "name": "User Name"
  }
}
```

### User Management Endpoints

#### Get User Profile
**GET** `/api/users/profile`
*Requires Authentication*

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "mongodb_id",
      "userId": "unique_user_id",
      "name": "User Name",
      "email": "user@example.com",
      "status": "available",
      "customStatus": "Working on project",
      "contacts": ["contact_id_1", "contact_id_2"]
    }
  }
}
```

#### Update User Profile
**PUT** `/api/users/profile`
*Requires Authentication*

**Request Body**:
```json
{
  "name": "Updated Name",
  "email": "updated@example.com"
}
```

### Status Management Endpoints

#### Get Current Status
**GET** `/api/status-management/current`
*Requires Authentication*

#### Update Status
**PUT** `/api/status-management/update`
*Requires Authentication*

**Request Body**:
```json
{
  "status": "busy",
  "customStatus": "In a meeting",
  "statusUntil": "2024-01-01T15:00:00.000Z"
}
```

#### Clear Status
**DELETE** `/api/status-management/clear`
*Requires Authentication*

### Contact Management Endpoints

#### Get Contacts
**GET** `/api/contacts`
*Requires Authentication*

#### Add Contact
**POST** `/api/contacts/add`
*Requires Authentication*

**Request Body**:
```json
{
  "contactUserId": "contact_user_id"
}
```

#### Remove Contact
**DELETE** `/api/contacts/remove`
*Requires Authentication*

**Request Body**:
```json
{
  "contactUserId": "contact_user_id"
}
```

## Error Handling

### Error Response Format
```json
{
  "success": false,
  "error": {
    "type": "ValidationError",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ],
    "statusCode": 400,
    "timestamp": "2024-01-01T00:00:00.000Z",
    "path": "/api/auth/register",
    "requestId": "req_123456789"
  }
}
```

### HTTP Status Codes

- **200 OK**: Request successful
- **201 Created**: Resource created successfully
- **400 Bad Request**: Invalid request data
- **401 Unauthorized**: Authentication required
- **403 Forbidden**: Access denied
- **404 Not Found**: Resource not found
- **409 Conflict**: Resource already exists
- **422 Unprocessable Entity**: Validation failed
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Server error
- **503 Service Unavailable**: Service temporarily unavailable

### Custom Error Types

- **ValidationError**: Input validation failed
- **AuthenticationError**: Authentication failed
- **AuthorizationError**: Access denied
- **NotFoundError**: Resource not found
- **ConflictError**: Resource conflict
- **RateLimitError**: Rate limit exceeded
- **DatabaseError**: Database operation failed

## WebSocket Events

### Connection
Clients connect using JWT authentication:
```javascript
const socket = io('ws://localhost:3000', {
  auth: {
    token: 'jwt_token_here'
  }
});
```

### Events

#### Server to Client Events

- **`contacts_status_initial`**: Initial status of all contacts
- **`contact_status_update`**: Real-time status updates
- **`force_disconnect`**: Server-initiated disconnect
- **`server_shutdown`**: Server maintenance notification

#### Client to Server Events

- **`update_contacts`**: Refresh contacts cache

## Best Practices

### Request Headers
Always include these headers:
```
Content-Type: application/json
Accept: application/json
X-API-Version: 1
Authorization: Bearer <token>
```

### Error Handling
Always check the `success` field in responses:
```javascript
if (response.success) {
  // Handle success
  const data = response.data;
} else {
  // Handle error
  const error = response.error;
  console.error(`${error.type}: ${error.message}`);
}
```

### Rate Limiting
Implement exponential backoff for rate-limited requests:
```javascript
const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
setTimeout(() => retryRequest(), delay);
```

### WebSocket Reconnection
Implement automatic reconnection with exponential backoff:
```javascript
socket.on('disconnect', () => {
  setTimeout(() => {
    socket.connect();
  }, Math.min(1000 * Math.pow(2, reconnectAttempts), 30000));
});
```

## Environment Variables

### Required
- **`MONGO_URI`**: MongoDB connection string
- **`JWT_SECRET`**: JWT signing secret
- **`NODE_ENV`**: Environment (development/production)

### Optional
- **`PORT`**: Server port (default: 3000)
- **`HOST`**: Server host (default: localhost)
- **`ALLOWED_ORIGINS`**: CORS allowed origins (production)

## Deployment Considerations

### Production Checklist
- [ ] Set `NODE_ENV=production`
- [ ] Configure `ALLOWED_ORIGINS` for CORS
- [ ] Set up proper logging
- [ ] Configure reverse proxy (nginx)
- [ ] Set up SSL/TLS certificates
- [ ] Configure database connection pooling
- [ ] Set up monitoring and alerting
- [ ] Configure backup strategies

### Monitoring
- Use `/health` endpoint for health checks
- Use `/metrics` endpoint for monitoring systems
- Monitor logs in `logs/` directory
- Set up alerts for error rates and response times

## Support
For technical support or questions about this API, please contact the development team.
