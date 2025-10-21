# 🚀 NVM Setup Guide - Run Both Node.js Versions

## 📋 Overview

This guide shows you how to run **both Node.js v24 and v20** simultaneously using NVM (Node Version Manager).

---

## 🎯 Two Approaches

### **Approach A: Single Server (Recommended - Simpler)**
- Run everything on Node.js v20
- One server, one port (5000)
- Admin panel + Mobile APIs together

### **Approach B: Dual Servers (Advanced - More Flexible)**
- Main server on Node.js v24 (port 5000)
- Admin server on Node.js v20 (port 5001)
- Run simultaneously in parallel

---

## 📥 Step 1: Install NVM for Windows

### Download NVM
**URL:** https://github.com/coreybutler/nvm-windows/releases

1. Download **`nvm-setup.exe`** (latest version)
2. Run the installer
3. Follow installation wizard
4. Restart your terminal/CMD

### Verify Installation
```bash
nvm version
# Should show: 1.x.x
```

---

## 📦 Step 2: Install Node.js Versions

```bash
# Install Node.js v20 LTS (for admin panel)
nvm install 20

# Install Node.js v24 (your current version)
nvm install 24

# List installed versions
nvm list
```

**Output:**
```
  * 24.4.1 (Currently using 64-bit executable)
    20.x.x
```

---

## 🎨 Approach A: Single Server (Recommended)

### Use Node.js v20 for Everything

```bash
# Switch to Node.js v20
nvm use 20

# Verify
node --version
# Output: v20.x.x

# Reinstall dependencies
cd d:\Backend
npm install

# Enable admin panel in server.js (uncomment lines)
# Then start server
npm run dev
```

### Enable Admin Panel

Uncomment these lines in `server.js`:

**Lines 59-62:**
```javascript
const { buildAdminRouter, sessionOptions } = require('./config/adminjs.config');
const session = require('express-session');
const adminDashboardRoutes = require('./routes/adminDashboardRoutes');
```

**Lines 174-186:**
```javascript
// Session middleware for admin panel
app.use(session(sessionOptions));

// Build and mount admin panel
const adminRouter = buildAdminRouter(app);
app.use(adminRouter);

// Admin dashboard API routes
app.use('/admin/api/dashboard', adminDashboardRoutes);

console.log('✅ Admin panel initialized at /admin');
```

### Access URLs
- **Mobile APIs:** http://localhost:5000/api/*
- **Admin Panel:** http://localhost:5000/admin

---

## 🚀 Approach B: Dual Servers (Advanced)

Run two servers simultaneously on different ports.

### Setup Complete! Files Already Created:
- ✅ `admin-server.js` - Separate admin server
- ✅ `start-both.bat` - Windows batch script
- ✅ Scripts added to `package.json`

### Method 1: Using Batch Script (Easiest)

**Double-click:** `start-both.bat`

This will:
1. Open Terminal 1: Main server (Node v24) on port 5000
2. Open Terminal 2: Admin server (Node v20) on port 5001

### Method 2: Manual Start

**Terminal 1 - Main Server (Node v24):**
```bash
nvm use 24
cd d:\Backend
npm run dev
```

**Terminal 2 - Admin Server (Node v20):**
```bash
nvm use 20
cd d:\Backend
npm run admin:dev
```

### Method 3: Using Concurrently (Single Terminal)

```bash
# Switch to Node v20 first
nvm use 20

# Start both servers
npm run both
```

**Note:** This runs both in one terminal but both use Node v20.

### Access URLs
- **Main Server (Mobile APIs):** http://localhost:5000/api/*
- **Admin Panel:** http://localhost:5001/admin
- **Admin Dashboard API:** http://localhost:5001/admin/api/dashboard/stats

---

## 📊 Comparison

| Feature | Approach A (Single) | Approach B (Dual) |
|---------|-------------------|-------------------|
| **Setup Complexity** | ⭐ Simple | ⭐⭐⭐ Advanced |
| **Node Version** | v20 only | v24 + v20 |
| **Ports Used** | 1 (5000) | 2 (5000, 5001) |
| **Terminals Needed** | 1 | 2 |
| **Admin Panel** | /admin | /admin (port 5001) |
| **Mobile APIs** | /api/* | /api/* (port 5000) |
| **Resource Usage** | Lower | Higher |
| **Flexibility** | Less | More |

---

## 🎯 Recommended Setup

### For Development (Local):
**Use Approach A** - Single server on Node.js v20
- Simpler
- Less resource usage
- Easier to manage

### For Production (VPS):
**Use Approach A** - Single server on Node.js v20
- Node.js v20 is LTS (Long Term Support)
- Stable and reliable
- Better for production

### For Testing/Advanced Use:
**Use Approach B** - Dual servers
- Test different Node versions
- Isolate admin panel
- More control

---

## 🔧 Common NVM Commands

```bash
# List installed versions
nvm list

# Install a version
nvm install 20
nvm install 24

# Switch version
nvm use 20
nvm use 24

# Check current version
node --version

# Set default version
nvm alias default 20

# Uninstall a version
nvm uninstall 24
```

---

## 📝 Quick Start Commands

### Approach A (Single Server - Node v20)
```bash
nvm use 20
cd d:\Backend
npm install
npm run dev
# Access: http://localhost:5000/admin
```

### Approach B (Dual Servers)
```bash
# Option 1: Use batch script
start-both.bat

# Option 2: Manual
# Terminal 1:
nvm use 24 && npm run dev

# Terminal 2:
nvm use 20 && npm run admin:dev
```

---

## 🆘 Troubleshooting

### NVM Command Not Found
```bash
# Restart terminal after installing NVM
# Or add to PATH manually
```

### Node Version Not Switching
```bash
# Close all Node processes
# Then switch version
nvm use 20
```

### Admin Panel Still Not Working
```bash
# Make sure you're on Node v20
node --version

# Reinstall dependencies
npm install

# Check if admin server is running
# Should see: ✅ Admin Panel: http://localhost:5001/admin
```

### Port Already in Use
```bash
# Change port in .env
PORT=5000
ADMIN_PORT=5002  # Change this

# Or kill process on port
netstat -ano | findstr :5001
taskkill /PID <PID> /F
```

---

## ✅ Final Setup Checklist

### Approach A (Single Server)
- [ ] Install NVM
- [ ] Install Node.js v20: `nvm install 20`
- [ ] Switch to v20: `nvm use 20`
- [ ] Reinstall dependencies: `npm install`
- [ ] Uncomment admin panel code in `server.js`
- [ ] Start server: `npm run dev`
- [ ] Access admin: http://localhost:5000/admin

### Approach B (Dual Servers)
- [ ] Install NVM
- [ ] Install Node.js v20: `nvm install 20`
- [ ] Install Node.js v24: `nvm install 24`
- [ ] Create admin user: `npm run create-admin`
- [ ] Run `start-both.bat` OR manual start
- [ ] Access main: http://localhost:5000
- [ ] Access admin: http://localhost:5001/admin

---

## 🎉 Success!

Once setup, you can:

✅ **Switch Node versions easily**
```bash
nvm use 20  # For admin work
nvm use 24  # For other work
```

✅ **Run both servers simultaneously**
```bash
start-both.bat
```

✅ **Access both services**
- Main Server: http://localhost:5000
- Admin Panel: http://localhost:5001/admin

---

## 📞 Quick Reference

```bash
# Install NVM
# Download from: https://github.com/coreybutler/nvm-windows/releases

# Install Node versions
nvm install 20
nvm install 24

# Switch versions
nvm use 20

# Start servers
npm run dev          # Main server
npm run admin:dev    # Admin server
npm run both         # Both (needs Node v20)
start-both.bat       # Both (different Node versions)
```

---

**Choose your approach and get started! 🚀**
