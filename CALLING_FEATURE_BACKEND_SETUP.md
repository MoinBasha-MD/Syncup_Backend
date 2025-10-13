# 📞 Calling Feature Backend Setup - COMPLETED

## ✅ What We've Implemented

### 1. **Call Model** (`models/callModel.js`)
- Stores call history, metadata, and status
- Tracks call duration, type (voice/video), participants
- Methods for querying call history and missed calls
- Automatic duration calculation

### 2. **Call Controller** (`controllers/callController.js`)
- `GET /api/calls/history` - Get user's call history
- `GET /api/calls/missed` - Get missed calls
- `POST /api/calls/missed/mark-seen` - Mark all missed calls as seen
- `POST /api/calls/:callId/mark-seen` - Mark specific call as seen
- `DELETE /api/calls/:callId` - Delete call from history
- `GET /api/calls/stats` - Get call statistics
- `GET /api/calls/:callId` - Get single call details

### 3. **Call Routes** (`routes/callRoutes.js`)
- All routes are protected (require authentication)
- Integrated with existing auth middleware

### 4. **WebRTC Signaling Events** (socketManager.js)
Added the following socket events:
- `call:initiate` - Start a call
- `call:answer` - Answer incoming call
- `call:reject` - Reject incoming call
- `call:end` - End active call
- `call:ice-candidate` - Exchange ICE candidates for P2P connection

### 5. **Call Management Features**
- ✅ Prevents duplicate calls (busy detection)
- ✅ Checks if user is online before initiating call
- ✅ Automatic call timeout after 60 seconds
- ✅ Tracks active calls in memory
- ✅ Stores call history in database
- ✅ Calculates call duration automatically

---

## 🚀 Next Steps (Run These Commands)

### **STEP 1: Install Required Dependency**

```bash
# SSH into your VPS
ssh root@45.129.86.96

# Navigate to backend directory
cd /path/to/backend

# Install uuid package
npm install uuid

# Restart your backend server
pm2 restart all
# OR if not using pm2:
# npm run dev
```

### **STEP 2: Verify Backend is Running**

```bash
# Check if server restarted successfully
pm2 logs

# Or check server status
pm2 status

# Verify the Call model is loaded (should see no errors)
curl http://45.129.86.96:5000/health
```

### **STEP 3: Test API Endpoints** (Optional)

```bash
# Get your auth token first
TOKEN="your_jwt_token_here"

# Test call history endpoint
curl -H "Authorization: Bearer $TOKEN" \
  http://45.129.86.96:5000/api/calls/history

# Should return empty array initially: {"success":true,"calls":[]}
```

---

## 📊 Backend Architecture Summary

### **WebRTC Signaling Flow:**

```
User A                    Backend                    User B
  |                          |                          |
  |--call:initiate---------->|                          |
  |  (offer SDP)             |                          |
  |                          |--call:incoming---------->|
  |                          |  (offer SDP)             |
  |                          |                          |
  |                          |<--call:answer------------|
  |<--call:answered----------|  (answer SDP)            |
  |  (answer SDP)            |                          |
  |                          |                          |
  |--call:ice-candidate----->|--call:ice-candidate----->|
  |<--call:ice-candidate-----|<--call:ice-candidate-----|
  |                          |                          |
  |        ✅ Call Connected via WebRTC P2P             |
  |<--------------------------------------------------->|
  |                          |                          |
  |--call:end--------------->|--call:ended------------->|
  |                          |                          |
```

### **Database Schema:**

```javascript
Call {
  callId: String (unique)
  callerId: String
  receiverId: String
  callType: 'voice' | 'video'
  status: 'initiated' | 'ringing' | 'connected' | 'ended' | 'missed' | 'rejected' | 'busy'
  startTime: Date
  endTime: Date
  duration: Number (seconds)
  endReason: String
  missedCallSeen: Boolean
}
```

### **Socket Events Implemented:**

| Event | Direction | Purpose |
|-------|-----------|---------|
| `call:initiate` | Client → Server | Start a call with offer SDP |
| `call:incoming` | Server → Client | Notify receiver of incoming call |
| `call:ringing` | Server → Client | Confirm call is ringing |
| `call:answer` | Client → Server | Answer call with answer SDP |
| `call:answered` | Server → Client | Notify caller of answer |
| `call:reject` | Client → Server | Reject incoming call |
| `call:rejected` | Server → Client | Notify caller of rejection |
| `call:end` | Client → Server | End active call |
| `call:ended` | Server → Client | Notify other party call ended |
| `call:ice-candidate` | Client ↔ Server ↔ Client | Exchange ICE candidates |
| `call:busy` | Server → Client | Receiver is busy |
| `call:failed` | Server → Client | Call setup failed |
| `call:timeout` | Server → Client | Call timed out (60s) |

---

## 🔒 Security Features

✅ **Authentication**: All API routes require valid JWT token  
✅ **Authorization**: Users can only access their own call history  
✅ **Busy Detection**: Prevents users from receiving multiple calls simultaneously  
✅ **Online Check**: Verifies receiver is online before initiating call  
✅ **Call Timeout**: Automatically marks calls as missed after 60 seconds  
✅ **Database Validation**: Mongoose schema validation on all call records  

---

## 📝 API Endpoints Reference

### **Get Call History**
```http
GET /api/calls/history?limit=50&page=1
Authorization: Bearer <token>

Response:
{
  "success": true,
  "calls": [...],
  "pagination": {
    "total": 100,
    "page": 1,
    "pages": 2,
    "limit": 50
  }
}
```

### **Get Missed Calls**
```http
GET /api/calls/missed
Authorization: Bearer <token>

Response:
{
  "success": true,
  "missedCalls": [...],
  "unseenCount": 3
}
```

### **Get Call Statistics**
```http
GET /api/calls/stats
Authorization: Bearer <token>

Response:
{
  "success": true,
  "stats": {
    "totalCalls": 150,
    "missedCalls": 5,
    "receivedCalls": 70,
    "madeCalls": 75,
    "totalDuration": 18000,
    "avgDuration": 120,
    "totalDurationMinutes": 300
  }
}
```

---

## ✅ Backend Setup Complete!

Your backend is now ready to handle WebRTC calling:
- ✅ Database models created
- ✅ API endpoints implemented
- ✅ Socket events configured
- ✅ Call management logic in place
- ✅ TURN server running on port 3478

**Next Phase: Frontend Implementation** 📱

Once you run `npm install uuid` and restart your backend, you're ready to move on to building the React Native frontend!

---

## 🐛 Troubleshooting

### **If backend won't start:**
```bash
# Check for syntax errors
npm run dev

# Check logs
pm2 logs

# Common issue: Missing uuid package
npm install uuid
```

### **If socket events aren't firing:**
```bash
# Check if backend is listening
netstat -tulpn | grep 5000

# Check socket connections
# In backend logs, look for: "User connected: [name]"
```

### **If calls aren't being created in database:**
```bash
# Check MongoDB connection
# In backend logs, look for: "MongoDB Connected"

# Test database connection
mongo
> use your_database_name
> db.calls.find()
```

---

**Ready to proceed with frontend implementation when you are!** 🚀
