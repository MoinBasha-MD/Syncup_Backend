# 🚀 Sync-Up Admin Panel - Quick Start

## ⚡ 3-Step Setup

### Step 1: Create Admin User (1 minute)
```bash
npm run create-admin
```

**Enter these details:**
```
Username: admin
Email: admin@syncup.com
Password: admin123456
Role: 1 (Super Admin)
```

### Step 2: Start Server (5 seconds)
```bash
npm run dev
```

**You'll see:**
```
✅ MongoDB Connected
✅ Admin panel initialized at /admin
🚀 HTTP Server running on http://0.0.0.0:5000
```

### Step 3: Login (10 seconds)
Open browser: **http://localhost:5000/admin**

**Login with:**
- Email: `admin@syncup.com`
- Password: `admin123456`

---

## 🎯 What You Can Do Now

### 👥 User Management
- View all users
- Activate/Deactivate users
- View user statistics
- Bulk operations

### 📊 Dashboard
- System overview
- Real-time statistics
- Health monitoring

### 📝 Content Moderation
- Manage posts
- Manage stories
- Delete expired content

### 🤖 AI System
- View AI instances
- Activate/Deactivate AI
- Monitor AI conversations

### 💬 Communication
- View messages
- Call history
- Group management

---

## 🔐 Default Credentials

**First Admin:**
- Email: `admin@syncup.com`
- Password: `admin123456`

**⚠️ IMPORTANT:** Change password after first login!

---

## 📍 Access URLs

| Environment | URL |
|-------------|-----|
| **Local** | http://localhost:5000/admin |
| **LAN** | http://192.168.x.x:5000/admin |
| **VPS** | http://your-vps-ip:5000/admin |

---

## ✅ Features Available

### ✨ Custom Actions
- **Users:** Activate, Deactivate, View Stats, Bulk Operations
- **Stories:** Delete Expired Stories
- **AI:** Activate/Deactivate AI Instances

### 📊 Dashboard APIs
- `/admin/api/dashboard/stats` - System statistics
- `/admin/api/dashboard/health` - System health
- `/admin/api/dashboard/activity` - Recent activity

### 🔒 Security
- Role-based access control
- Session management
- Account lockout protection
- Separate from mobile app

---

## 🎨 Admin Roles

| Role | Access Level |
|------|-------------|
| **Super Admin** | Full access to everything |
| **Admin** | Most access, cannot delete critical data |
| **Moderator** | Content management focus |
| **Viewer** | Read-only access |

---

## 💡 Pro Tips

1. **Create Multiple Admins:**
   ```bash
   npm run create-admin
   ```

2. **Check Dashboard Stats:**
   - Login → Dashboard shows real-time stats

3. **Bulk Operations:**
   - Select multiple users → Click "Bulk Actions"

4. **Custom Actions:**
   - Click on any user → See custom action buttons

5. **Search & Filter:**
   - Use search bar and filters on any page

---

## 🆘 Troubleshooting

### Can't Access /admin?
```bash
# Check if server is running
npm run dev

# Check MongoDB connection
# Make sure MongoDB is running on localhost:27017
```

### Login Fails?
```bash
# Create admin user again
npm run create-admin
```

### Account Locked?
```javascript
// In MongoDB or Node.js script:
const Admin = require('./models/adminModel');
const admin = await Admin.findOne({ email: 'your@email.com' });
await admin.resetLoginAttempts();
```

---

## 🎉 You're Ready!

Your admin panel is fully configured and ready to use!

**Next Steps:**
1. ✅ Create admin user
2. ✅ Start server
3. ✅ Login
4. ✅ Explore features
5. ✅ Manage your Sync-Up backend

---

## 📚 Full Documentation

- **Complete Guide:** `ADMIN_PANEL_GUIDE.md`
- **API Docs:** `API_DOCUMENTATION.md`
- **README:** `README.md`

---

**Happy Administrating! 🚀**
