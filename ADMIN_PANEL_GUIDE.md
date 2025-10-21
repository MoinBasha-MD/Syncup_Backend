# 🎯 Sync-Up Backend Admin Panel - Complete Guide

## 📋 Overview

The Sync-Up Admin Panel is a comprehensive web-based administration interface for managing your entire backend system. Built with AdminJS, it provides a beautiful, intuitive interface for all your data management needs.

---

## 🚀 Quick Start (3 Steps)

### Step 1: Create Admin User
```bash
npm run create-admin
```

**Example Input:**
```
Username: admin
Email: admin@syncup.com
Password: admin123456
Role: 1 (Super Admin)
```

### Step 2: Start Server
```bash
npm run dev
```

You'll see:
```
✅ Admin panel initialized at /admin
🚀 HTTP Server running on http://0.0.0.0:5000
```

### Step 3: Login
- **Local:** http://localhost:5000/admin
- **VPS:** http://your-vps-ip:5000/admin

---

## 🎨 Admin Panel Features

### 📊 Dashboard
- **System Overview**
  - Total users count
  - Active users (online now)
  - Messages sent today
  - Stories posted today
  - AI instances active
  - Server health metrics

### 👥 User Management
**Location:** Admin Panel → Users

**Features:**
- View all registered users
- Search by name, phone, email
- Filter by status (available, busy, away, etc.)
- Filter by active/inactive accounts
- Edit user profiles
- Deactivate/activate accounts
- View user details:
  - Profile information
  - Current status
  - Last seen
  - Registration date
  - Profile image

**Actions:**
- ✏️ Edit user details
- 🔍 View full profile
- 🚫 Deactivate account
- ✅ Activate account

### 📈 Status Management
**Location:** Admin Panel → Status

#### Status History
- View all status changes
- Filter by user
- Filter by date range
- See duration of each status
- Export status reports

#### Status Schedules
- View scheduled status changes
- See recurring schedules
- Edit/delete schedules
- Activate/deactivate schedules

#### Status Templates
- View saved templates
- Edit template details
- Delete unused templates

#### Status Privacy
- View privacy settings
- Manage who can see statuses
- Privacy rules management

### 📝 Content Management
**Location:** Admin Panel → Content

#### Posts
- View all user posts
- Filter by user
- See likes and comments count
- Moderate content
- Delete inappropriate posts

#### Stories
- View all active stories
- See story views count
- Check expiration times
- Moderate story content
- Delete stories

#### Story Interactions
- Story Likes
- Story Views
- Story Seen tracking

### 💬 Communication
**Location:** Admin Panel → Communication

#### Messages
- View chat messages
- Filter by sender/receiver
- See message status (sent, delivered, read)
- Message type (text, image, voice, etc.)
- Search messages

#### Calls
- View call history
- Filter by caller/receiver
- See call type (voice/video)
- Call duration
- Call status (completed, missed, rejected)

### 👥 Groups
**Location:** Admin Panel → Groups

#### Group Management
- View all groups
- See member counts
- Group descriptions
- Created by information
- Edit group details

#### Group Chats
- View group chat rooms
- See active chats
- Manage chat settings

#### Group Messages
- View group messages
- Filter by group
- Message moderation

#### Group Members
- View members of each group
- Member roles
- Join dates

#### Group AI Networks
- AI instances in groups
- Group AI interactions

### 🔗 Connections
**Location:** Admin Panel → Connections

#### Connection Requests
- View all friend requests
- Filter by status (pending, accepted, rejected)
- See request dates
- Manage connections

#### Blocked Users
- View all blocks
- See blocker and blocked users
- Block reasons
- Unblock users

### 🤖 AI System (DIYA)
**Location:** Admin Panel → AI System

#### AI Instances
- View all AI instances
- See which user owns each AI
- AI status (active/inactive)
- AI names
- Creation dates

#### AI Assistants
- View AI assistant configurations
- Assistant capabilities
- Settings management

#### AI Conversations
- View AI conversation logs
- Conversation history
- Conversation topics

#### AI Message Queue
- View queued AI messages
- Message priority
- Processing status
- From/To AI instances

#### DIYA Requests
- Cross-user AI requests
- Request status
- Requester and target user
- Request details

#### DIYA Memory
- AI conversation memory
- Memory management
- Context storage

---

## 👥 Admin Roles & Permissions

### 🔴 Super Admin
**Full System Access**

✅ **Users:** View, Edit, Delete  
✅ **Content:** View, Edit, Delete  
✅ **AI System:** View, Edit, Delete  
✅ **System Settings:** View, Edit  
✅ **Admin Management:** Create, Edit, Delete admins  

**Use Case:** System owner, technical lead

---

### 🟠 Admin
**Most Access (Safe Operations)**

✅ **Users:** View, Edit  
❌ **Users:** Cannot Delete  
✅ **Content:** View, Edit, Delete  
✅ **AI System:** View, Edit  
❌ **AI System:** Cannot Delete  
✅ **System Settings:** View only  
❌ **Admin Management:** No access  

**Use Case:** Operations manager, senior moderator

---

### 🟡 Moderator
**Content Focus**

✅ **Users:** View only  
✅ **Content:** View, Edit, Delete  
✅ **AI System:** View only  
❌ **System Settings:** No access  
❌ **Admin Management:** No access  

**Use Case:** Content moderator, community manager

---

### 🟢 Viewer
**Read-Only Access**

✅ **All Resources:** View only  
❌ **No Edit Permissions**  
❌ **No Delete Permissions**  
❌ **No System Access**  

**Use Case:** Analysts, stakeholders, auditors

---

## 🔐 Security Features

### Authentication
- ✅ Secure password hashing (bcrypt)
- ✅ Session-based authentication
- ✅ Separate from user authentication
- ✅ 24-hour session timeout

### Account Protection
- ✅ Failed login tracking
- ✅ Account lockout after 5 failed attempts
- ✅ 2-hour lockout duration
- ✅ Automatic unlock after timeout

### Session Security
- ✅ HttpOnly cookies
- ✅ Secure cookies in production
- ✅ MongoDB session storage
- ✅ CSRF protection

### Access Control
- ✅ Role-based permissions
- ✅ Resource-level access control
- ✅ Action-level permissions
- ✅ Audit logging

---

## 📊 Available Resources

| # | Resource | Collection | Records |
|---|----------|------------|---------|
| 1 | Admin Users | admins | Admin accounts |
| 2 | Users | users | App users |
| 3 | Status History | statushistories | Status logs |
| 4 | Status Schedules | statusschedules | Scheduled statuses |
| 5 | Status Templates | statustemplates | Status templates |
| 6 | Status Privacy | statusprivacies | Privacy settings |
| 7 | Posts | posts | User posts |
| 8 | Stories | stories | User stories |
| 9 | Story Likes | storylikes | Story reactions |
| 10 | Story Seen | storyseens | Story views |
| 11 | Story Views | storyviews | View tracking |
| 12 | Messages | messages | Chat messages |
| 13 | Calls | calls | Call history |
| 14 | Groups | groups | User groups |
| 15 | Group Chats | groupchats | Group chat rooms |
| 16 | Group Messages | groupmessages | Group messages |
| 17 | Group Members | groupmembers | Group membership |
| 18 | Group AI Networks | groupainetworks | Group AI systems |
| 19 | Connection Requests | connectionrequests | Friend requests |
| 20 | Blocks | blocks | Blocked users |
| 21 | AI Instances | aiinstances | User AI instances |
| 22 | AI Assistants | aiassistants | AI configurations |
| 23 | AI Conversations | aiconversations | AI chat logs |
| 24 | AI Message Queue | aimessagequeues | AI message queue |
| 25 | DIYA Requests | diyarequests | Cross-user AI |
| 26 | DIYA Memory | diyamemories | AI memory |

**Total: 26 Resources**

---

## 🛠️ Common Administrative Tasks

### Create New Admin
```bash
npm run create-admin
```

### Reset Admin Password
```javascript
// Connect to MongoDB and run:
const Admin = require('./models/adminModel');
const admin = await Admin.findOne({ email: 'admin@syncup.com' });
admin.password = 'newpassword123';
await admin.save(); // Auto-hashed
```

### Unlock Locked Admin Account
```javascript
const admin = await Admin.findOne({ email: 'locked@syncup.com' });
await admin.resetLoginAttempts();
```

### Change Admin Role
```javascript
const admin = await Admin.findOne({ email: 'user@syncup.com' });
admin.role = 'super-admin'; // or 'admin', 'moderator', 'viewer'
await admin.save(); // Permissions auto-updated
```

### Deactivate Admin
```javascript
const admin = await Admin.findOne({ email: 'user@syncup.com' });
admin.isActive = false;
await admin.save();
```

---

## 🌐 VPS Deployment

### Auto-Start Configuration
The admin panel automatically starts with your server:

```bash
# Development
npm run dev

# Production
npm start
```

### Access URLs
- **Local:** http://localhost:5000/admin
- **LAN:** http://192.168.x.x:5000/admin
- **VPS:** http://your-vps-ip:5000/admin
- **Domain:** http://yourdomain.com:5000/admin

### Environment Variables
Ensure these are set in `.env`:

```env
MONGO_URI=mongodb://localhost:27017/rightview
JWT_SECRET=your_secure_secret_key
NODE_ENV=production  # For production
PORT=5000
```

---

## 📱 Mobile App Impact

### ✅ Zero Impact Guarantee

The admin panel **does NOT affect** your mobile application:

| Aspect | Mobile App | Admin Panel |
|--------|------------|-------------|
| **Routes** | `/api/*` | `/admin/*` |
| **Auth** | JWT tokens | Session-based |
| **Users** | User model | Admin model |
| **Performance** | Unchanged | Separate |
| **Database** | Same collections | +2 collections |

**Your mobile app APIs work exactly the same!**

---

## 🎨 Customization

### Branding
The admin panel is branded as **"Sync-Up Backend"** with a custom color scheme.

### Theme Colors
- Primary: Indigo (#4F46E5)
- Accent: Purple (#6366F1)
- Modern, professional design

### Login Page
- Custom welcome message
- "Sync-Up Backend Admin" branding
- Clean, modern interface

---

## 📈 Performance

### Resource Usage
- **Memory:** ~50MB (admin panel only)
- **CPU:** Minimal when not in use
- **Database:** 2 additional collections
- **Network:** No impact on API traffic

### Optimization
- Lazy loading of resources
- Pagination for large datasets
- Efficient database queries
- Session caching

---

## 🔍 Troubleshooting

### Cannot Access /admin
**Check:**
1. Server is running (`npm run dev`)
2. MongoDB is connected
3. Port 5000 is accessible
4. No firewall blocking

### Login Fails
**Check:**
1. Admin user exists (`npm run create-admin`)
2. Password is correct
3. Account is not locked
4. Account is active

### Account Locked
**Solution:**
```javascript
// Reset login attempts
const admin = await Admin.findOne({ email: 'your@email.com' });
await admin.resetLoginAttempts();
```

### Session Expired
**Solution:**
- Simply login again
- Sessions last 24 hours
- Automatic cleanup

---

## 📞 Support

### Documentation
- This guide
- API Documentation: `API_DOCUMENTATION.md`
- README: `README.md`

### Logs
Check server logs for admin panel activity:
```bash
# Server logs
npm run logs:server

# All logs
tail -f logs/*.log
```

---

## 🎉 You're All Set!

Your Sync-Up Admin Panel is ready to use. Access it at:

**http://localhost:5000/admin**

Happy administrating! 🚀
