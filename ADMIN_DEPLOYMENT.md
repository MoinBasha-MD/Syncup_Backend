# 🚀 Sync-Up Admin Panel - Deployment Guide

## 📋 Pre-Deployment Checklist

### ✅ Phase 1: Local Testing

1. **Create Admin User**
   ```bash
   npm run create-admin
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```

3. **Test Admin Panel**
   - Access: http://localhost:5000/admin
   - Login with created credentials
   - Test all features

4. **Test Mobile API (Ensure No Impact)**
   - Test mobile app APIs: http://localhost:5000/api/*
   - Verify response times unchanged
   - Verify authentication still works

---

## 🌐 VPS Deployment

### Step 1: Prepare VPS Environment

```bash
# SSH into your VPS
ssh user@your-vps-ip

# Navigate to backend directory
cd /path/to/backend

# Pull latest code
git pull origin main
```

### Step 2: Install Dependencies

```bash
# Install all dependencies (if not already installed)
npm install

# Verify AdminJS dependencies
npm list adminjs @adminjs/express @adminjs/mongoose express-session connect-mongo
```

### Step 3: Environment Configuration

Update `.env` file on VPS:

```env
# MongoDB Configuration
MONGO_URI=mongodb://localhost:27017/rightview

# Server Configuration
PORT=5000
NODE_ENV=production
ALLOWED_ORIGINS=http://your-domain.com,https://your-domain.com

# JWT Configuration
JWT_SECRET=your_secure_production_secret_key

# Redis Configuration (if using)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_ENABLED=true
```

### Step 4: Create Production Admin User

```bash
# Create admin user on VPS
npm run create-admin
```

**Recommended Production Credentials:**
```
Username: admin_prod
Email: admin@yourdomain.com
Password: [Strong password with 12+ characters]
Role: 1 (Super Admin)
```

### Step 5: Start Production Server

**Option A: Using PM2 (Recommended)**
```bash
# Install PM2 globally (if not installed)
npm install -g pm2

# Start server with PM2
pm2 start server.js --name syncup-backend

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

**Option B: Using systemd**
```bash
# Create systemd service file
sudo nano /etc/systemd/system/syncup-backend.service
```

Add this content:
```ini
[Unit]
Description=Sync-Up Backend Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl enable syncup-backend
sudo systemctl start syncup-backend
sudo systemctl status syncup-backend
```

**Option C: Using npm start**
```bash
# Simple start (not recommended for production)
npm start
```

### Step 6: Configure Firewall

```bash
# Allow port 5000
sudo ufw allow 5000/tcp

# Check firewall status
sudo ufw status
```

### Step 7: Access Admin Panel

**URLs:**
- **Direct IP:** http://your-vps-ip:5000/admin
- **With Domain:** http://yourdomain.com:5000/admin

---

## 🔒 Security Hardening

### 1. Change Default Port (Optional)

Update `.env`:
```env
PORT=8080  # Or any other port
```

Update firewall:
```bash
sudo ufw allow 8080/tcp
sudo ufw delete allow 5000/tcp
```

### 2. Setup Nginx Reverse Proxy (Recommended)

Install Nginx:
```bash
sudo apt update
sudo apt install nginx
```

Create Nginx configuration:
```bash
sudo nano /etc/nginx/sites-available/syncup-admin
```

Add configuration:
```nginx
server {
    listen 80;
    server_name admin.yourdomain.com;

    location /admin {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/syncup-admin /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 3. Setup SSL with Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d admin.yourdomain.com

# Auto-renewal is setup automatically
```

### 4. IP Whitelisting (Optional)

Update Nginx configuration:
```nginx
location /admin {
    # Allow specific IPs
    allow 203.0.113.0/24;  # Your office IP range
    allow 198.51.100.1;     # Your home IP
    deny all;

    proxy_pass http://localhost:5000;
    # ... rest of proxy settings
}
```

### 5. Rate Limiting

AdminJS already has session-based protection, but you can add Nginx rate limiting:

```nginx
# Add to http block in /etc/nginx/nginx.conf
limit_req_zone $binary_remote_addr zone=admin_limit:10m rate=10r/m;

# Add to location block
location /admin {
    limit_req zone=admin_limit burst=5;
    # ... rest of configuration
}
```

---

## 📊 Monitoring

### 1. PM2 Monitoring

```bash
# View logs
pm2 logs syncup-backend

# Monitor resources
pm2 monit

# View status
pm2 status
```

### 2. Server Logs

```bash
# View server logs
tail -f logs/server.log

# View all logs
tail -f logs/*.log
```

### 3. Admin Panel Health Check

Access: http://your-vps-ip:5000/admin/api/dashboard/health

Response:
```json
{
  "success": true,
  "data": {
    "database": { "status": "connected" },
    "memory": { "heapUsed": 150, "heapTotal": 200 },
    "uptime": { "days": 5, "hours": 12 }
  }
}
```

---

## 🔄 Updates & Maintenance

### Updating Admin Panel

```bash
# Pull latest code
git pull origin main

# Install any new dependencies
npm install

# Restart server
pm2 restart syncup-backend

# Or with systemd
sudo systemctl restart syncup-backend
```

### Database Backup

```bash
# Backup MongoDB
mongodump --db rightview --out /backup/$(date +%Y%m%d)

# Backup admin sessions
mongodump --db rightview --collection admin_sessions --out /backup/sessions_$(date +%Y%m%d)
```

### Admin User Management

```bash
# Create new admin
npm run create-admin

# List all admins (MongoDB shell)
mongo rightview
db.admins.find().pretty()

# Deactivate admin
db.admins.updateOne(
  { email: "old@admin.com" },
  { $set: { isActive: false } }
)
```

---

## 🧪 Testing Checklist

### Before Deployment

- [ ] Admin user created
- [ ] Can login to admin panel
- [ ] All resources visible
- [ ] Custom actions work
- [ ] Dashboard stats load
- [ ] Mobile API still works
- [ ] No performance degradation

### After Deployment

- [ ] Admin panel accessible via VPS IP
- [ ] Login works on production
- [ ] SSL certificate installed (if using)
- [ ] Firewall configured
- [ ] PM2/systemd running
- [ ] Logs are being written
- [ ] Mobile app still works
- [ ] No errors in logs

---

## 🆘 Troubleshooting

### Admin Panel Not Accessible

**Check Server:**
```bash
# Check if server is running
pm2 status
# or
sudo systemctl status syncup-backend

# Check logs
pm2 logs syncup-backend
# or
tail -f logs/server.log
```

**Check Port:**
```bash
# Check if port is open
sudo netstat -tulpn | grep 5000

# Check firewall
sudo ufw status
```

### MongoDB Connection Issues

```bash
# Check MongoDB status
sudo systemctl status mongod

# Start MongoDB
sudo systemctl start mongod

# Check connection
mongo rightview
```

### Session Issues

```bash
# Clear admin sessions
mongo rightview
db.admin_sessions.deleteMany({})
```

### Performance Issues

```bash
# Check memory usage
free -h

# Check CPU usage
top

# Check disk space
df -h

# Restart server
pm2 restart syncup-backend
```

---

## 📈 Performance Optimization

### 1. Enable Compression

Already enabled in server.js:
```javascript
app.use(compression());
```

### 2. MongoDB Indexes

Indexes are automatically created by models.

### 3. Redis Caching

If Redis is enabled, sessions are cached automatically.

### 4. PM2 Cluster Mode

```bash
# Start in cluster mode (use all CPU cores)
pm2 start server.js -i max --name syncup-backend
```

---

## 🎯 Production Best Practices

### 1. Regular Backups
- Daily MongoDB backups
- Weekly full system backups
- Store backups off-site

### 2. Monitoring
- Setup uptime monitoring (UptimeRobot, Pingdom)
- Monitor server resources
- Setup alerts for errors

### 3. Security
- Regular security updates
- Strong admin passwords
- IP whitelisting for admin panel
- SSL/TLS encryption
- Regular security audits

### 4. Logging
- Rotate logs regularly
- Monitor error logs
- Setup log aggregation (optional)

### 5. Updates
- Test updates in staging first
- Keep dependencies updated
- Document all changes

---

## 📞 Support & Resources

### Documentation
- **Quick Start:** `QUICK_START_ADMIN.md`
- **Full Guide:** `ADMIN_PANEL_GUIDE.md`
- **API Docs:** `API_DOCUMENTATION.md`

### Logs Location
- Server: `logs/server.log`
- AI: `logs/ai-communication.log`
- Connections: `logs/connections.log`

### Admin Panel URLs
- Local: http://localhost:5000/admin
- VPS: http://your-vps-ip:5000/admin
- Domain: http://admin.yourdomain.com

---

## ✅ Deployment Complete!

Your Sync-Up Admin Panel is now deployed and ready for production use!

**Post-Deployment:**
1. ✅ Change default admin password
2. ✅ Setup monitoring
3. ✅ Configure backups
4. ✅ Document access credentials
5. ✅ Train team members

**Happy Managing! 🚀**
