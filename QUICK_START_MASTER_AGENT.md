# 🚀 Quick Start Guide - Master Agent System

## 5-Minute Setup

### Step 1: Generate Encryption Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output (64 character hex string).

### Step 2: Update .env File

Add to your `.env`:

```env
# Log Encryption (paste the key from Step 1)
LOG_ENCRYPTION_KEY=your_generated_key_here
```

### Step 3: Start Master Agent

```bash
npm run master
```

You'll see this menu:

```
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║              🤖 SYNCUP MASTER AGENT CONTROL CENTER             ║
║                                                                ║
║                    Backend Management System                   ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝

SERVER CONTROL:
  1. Start Server
  2. Stop Server
  3. Restart Server
  4. Server Status

AGENT MANAGEMENT:
  5. Start All Agents
  6. Stop All Agents
  7. Agent Status Report
  8. Start Individual Agent

MONITORING & DIAGNOSTICS:
  9. View Live Logs
  10. System Health Report
  11. Memory Analysis
  12. Performance Metrics
```

### Step 4: Start Everything

1. Press `1` to start the server
2. Press `5` to start all monitoring agents
3. Press `10` to view system health

**Done!** Your backend is now running with full monitoring and encrypted logging.

---

## Common Tasks

### View System Status

```bash
npm run master
# Then press: 10
```

### Check Logs

```bash
npm run master
# Then press: 9
# Enter: server (or ai-communication, connections, database, errors)
```

### Monitor Memory

```bash
npm run agent:memory-monitor
```

### Monitor Performance

```bash
npm run agent:performance
```

### Check Server Health

```bash
npm run agent:health-check
```

---

## Update Your Code

### Before (Unsafe):
```javascript
console.log(`User logged in: ${user.name} (${user.phoneNumber})`);
```

### After (Safe):
```javascript
const { logServerSafe } = require('./utils/loggerSetup');

logServerSafe('info', 'User logged in', {
  name: user.name,
  phoneNumber: user.phoneNumber
}, 'mask');
```

**Output**: `User logged in: J*** D*** (Phone: +******7890)`

---

## Testing Encryption

Run this test:

```bash
node -e "
const logEncryption = require('./utils/logEncryption');

const user = {
  name: 'John Doe',
  phoneNumber: '+1234567890',
  email: 'john@example.com'
};

console.log('Original:', user);
console.log('Masked:', logEncryption.processObject(user, 'mask'));
console.log('Encrypted:', logEncryption.processObject(user, 'encrypt'));
console.log('Hashed:', logEncryption.processObject(user, 'hash'));
"
```

---

## Production Deployment

### Option 1: Using Master Agent

```bash
# Start master agent
npm run master

# In menu:
# 1. Start Server
# 5. Start All Agents
```

### Option 2: Using PM2

```bash
# Install PM2
npm install -g pm2

# Start server
pm2 start server.js --name syncup-server

# Start agents
pm2 start agents/logMonitorAgent.js --name log-monitor
pm2 start agents/healthCheckAgent.js --name health-check
pm2 start agents/memoryMonitorAgent.js --name memory-monitor
pm2 start agents/performanceAnalyzerAgent.js --name performance-analyzer

# Save configuration
pm2 save

# Setup startup script
pm2 startup
```

### Option 3: Using systemd (Linux)

Create `/etc/systemd/system/syncup-master.service`:

```ini
[Unit]
Description=Syncup Master Agent
After=network.target

[Service]
Type=simple
User=your_user
WorkingDirectory=/path/to/Backend
ExecStart=/usr/bin/node agents/masterAgent.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable syncup-master
sudo systemctl start syncup-master
sudo systemctl status syncup-master
```

---

## Troubleshooting

### Master Agent Won't Start

```bash
# Check Node version (should be >= 14)
node --version

# Check if port is in use
netstat -ano | findstr :5000

# Check logs
cat logs/agents/master.log
```

### Agents Not Connecting

```bash
# Verify agent files exist
ls agents/

# Check permissions
chmod +x agents/*.js

# Try starting individually
npm run agent:log-monitor
```

### High Memory Usage

```bash
# Start memory monitor
npm run agent:memory-monitor

# Check recommendations in output
# Agent will suggest optimizations
```

### Encryption Not Working

```bash
# Verify LOG_ENCRYPTION_KEY is set
echo $LOG_ENCRYPTION_KEY  # Linux/Mac
echo %LOG_ENCRYPTION_KEY%  # Windows

# Test encryption
node examples/encryptedLoggingExample.js
```

---

## Next Steps

1. **Update Existing Code**: Replace `console.log` with `logServerSafe`
2. **Set Up Alerts**: Configure email/SMS notifications
3. **Monitor Regularly**: Check agent reports daily
4. **Optimize**: Follow agent recommendations
5. **Backup**: Set up log rotation and backups

---

## Support

- 📖 Full Documentation: `MASTER_AGENT_README.md`
- 💡 Examples: `examples/encryptedLoggingExample.js`
- 🐛 Issues: Check `logs/errors.log`
- 📊 Health: Run system health report (option 10 in Master Agent)

---

## Key Benefits

✅ **Security**: All PII automatically encrypted in logs  
✅ **Monitoring**: Real-time system health tracking  
✅ **Control**: Centralized server management  
✅ **Alerts**: Automatic detection of issues  
✅ **Performance**: Optimization recommendations  
✅ **Compliance**: GDPR/privacy law compliance  

---

**You're all set!** Your backend is now secure, monitored, and manageable. 🎉
