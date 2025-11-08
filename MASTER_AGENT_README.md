# 🤖 Master Agent System - Backend Management & Monitoring

## Overview

The Master Agent system provides a comprehensive solution for managing, monitoring, and securing your Syncup backend. It includes:

1. **Log Encryption** - Automatic encryption of sensitive user data (PII) in logs
2. **Master Agent** - Central control system for managing the backend
3. **Sub-Agents** - Specialized monitoring agents for different aspects

---

## 🔐 Log Encryption System

### Features

- **Automatic PII Detection**: Identifies sensitive fields (names, phone numbers, emails, etc.)
- **Multiple Protection Modes**:
  - `mask` - Partial visibility (e.g., +******7890)
  - `encrypt` - Full AES-256-CBC encryption
  - `hash` - One-way hashing for identification
- **Nested Object Support**: Recursively processes complex objects
- **Zero Configuration**: Works out of the box

### Usage

#### Basic Usage

```javascript
const { logServerSafe, logConnectionSafe } = require('./utils/loggerSetup');

// Instead of:
console.log(`User logged in: ${user.name} (${user.phoneNumber})`);

// Use:
logServerSafe('info', 'User logged in', {
  name: user.name,
  phoneNumber: user.phoneNumber,
  userId: user.userId
}, 'mask'); // or 'encrypt' or 'hash'
```

#### Output Examples

**Mask Mode** (Default):
```
User: J*** D*** (Phone: +******7890, Email: j***@example.com)
```

**Encrypt Mode**:
```
User: ENC[a1b2c3:d4e5f6...] (Phone: ENC[x7y8z9:...])
```

**Hash Mode**:
```
User: HASH[a1b2c3d4e5f6] (Phone: HASH[x7y8z9a1b2c3])
```

### Configuration

Add to your `.env` file:

```env
# Log Encryption Key (32 bytes hex)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
LOG_ENCRYPTION_KEY=your_64_character_hex_key_here
```

If not provided, a random key is generated (not recommended for production).

---

## 🎮 Master Agent Control Center

### Starting the Master Agent

```bash
npm run master
```

### Features

The Master Agent provides an interactive CLI with the following capabilities:

#### Server Control
- **Start Server** - Launch the Syncup backend
- **Stop Server** - Gracefully shutdown the server
- **Restart Server** - Quick restart with minimal downtime
- **Server Status** - View current server state

#### Agent Management
- **Start All Agents** - Launch all monitoring agents
- **Stop All Agents** - Shutdown all agents
- **Agent Status Report** - View status of all agents
- **Start Individual Agent** - Launch specific agents

#### Monitoring & Diagnostics
- **View Live Logs** - Real-time log viewing
- **System Health Report** - Comprehensive system status
- **Memory Analysis** - Memory usage and leak detection
- **Performance Metrics** - CPU, load, and throughput analysis

#### Utilities
- **Clear Logs** - Clean up log files
- **Backup Configuration** - Save current settings
- **View Agent Logs** - Check agent-specific logs

---

## 🤖 Sub-Agents

### 1. Log Monitor Agent

**Purpose**: Monitors log files for errors, warnings, and security issues

**Features**:
- Real-time log analysis
- Pattern detection (errors, warnings, security events)
- PII encryption verification
- Periodic reporting

**Start**:
```bash
npm run agent:log-monitor
```

**Monitors**:
- Error patterns
- Security events (unauthorized access, failed auth)
- Performance issues (timeouts, slow queries)
- Unencrypted PII detection

---

### 2. Health Check Agent

**Purpose**: Ensures server and database are running properly

**Features**:
- Server availability checks
- Database connectivity monitoring
- Automatic failure detection
- Recovery recommendations

**Start**:
```bash
npm run agent:health-check
```

**Checks**:
- HTTP endpoint availability
- Database ping and connection
- Memory usage warnings
- Consecutive failure tracking

---

### 3. Memory Monitor Agent

**Purpose**: Tracks memory usage and detects leaks

**Features**:
- System memory tracking
- Process memory analysis
- Memory leak detection
- Optimization recommendations

**Start**:
```bash
npm run agent:memory-monitor
```

**Monitors**:
- System memory (total, used, free)
- Node.js heap usage
- Memory trends over time
- Leak detection algorithms

---

### 4. Performance Analyzer Agent

**Purpose**: Analyzes CPU, load, and performance metrics

**Features**:
- CPU usage tracking
- Load average monitoring
- Network statistics
- Performance optimization tips

**Start**:
```bash
npm run agent:performance
```

**Analyzes**:
- CPU usage per core
- System load (1min, 5min, 15min)
- Network throughput
- Performance trends

---

## 📊 Usage Examples

### Example 1: Starting Everything

```bash
# Terminal 1: Start Master Agent
npm run master

# In Master Agent menu:
# 1. Press '1' to start server
# 2. Press '5' to start all agents
# 3. Press '10' to view system health
```

### Example 2: Individual Agent Monitoring

```bash
# Terminal 1: Start server
npm start

# Terminal 2: Monitor logs
npm run agent:log-monitor

# Terminal 3: Monitor performance
npm run agent:performance

# Terminal 4: Monitor memory
npm run agent:memory-monitor
```

### Example 3: Using Encrypted Logging in Code

```javascript
// In your controller
const { logServerSafe, logEncryption } = require('../utils/loggerSetup');

// Login endpoint
exports.login = async (req, res) => {
  const { phoneNumber, password } = req.body;
  
  // Log with masked PII
  logServerSafe('info', 'Login attempt', {
    phoneNumber,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  }, 'mask');
  
  // ... authentication logic ...
  
  if (user) {
    logServerSafe('info', 'Login successful', {
      userId: user.userId,
      name: user.name,
      phoneNumber: user.phoneNumber
    }, 'hash'); // Use hash for audit trail
  }
};
```

---

## 🔧 Configuration

### Environment Variables

```env
# Server Configuration
PORT=5000
SERVER_URL=http://localhost:5000

# Database
MONGO_URI=mongodb://localhost:27017/syncup

# Security
JWT_SECRET=your_jwt_secret_here
LOG_ENCRYPTION_KEY=your_64_character_hex_key_here

# Agent Configuration (optional)
AGENT_CHECK_INTERVAL=30000
AGENT_REPORT_INTERVAL=60000
MEMORY_ALERT_THRESHOLD=0.85
CPU_ALERT_THRESHOLD=80
```

### Agent Configuration

Create `agents/config.json` for custom settings:

```json
{
  "logMonitor": {
    "reportInterval": 60000,
    "patterns": {
      "custom": "/your-pattern/i"
    }
  },
  "healthCheck": {
    "checkInterval": 30000,
    "maxConsecutiveFailures": 3
  },
  "memoryMonitor": {
    "checkInterval": 10000,
    "alertThreshold": 0.85
  },
  "performanceAnalyzer": {
    "checkInterval": 15000
  }
}
```

---

## 📈 Monitoring Dashboard

### System Health Report Output

```
═══════════════════════════════════════════════════════════
                  SYSTEM HEALTH REPORT                     
═══════════════════════════════════════════════════════════

System Information:
  Platform: win32
  Architecture: x64
  Node Version: v18.17.0
  Uptime: 24 hours

Memory Status:
  Total: 16.00 GB
  Used: 8.50 GB (53.13%)
  Free: 7.50 GB

CPU Information:
  Cores: 8
  Model: Intel(R) Core(TM) i7-9700K

Server Status:
  Status: RUNNING
  PID: 12345

Agent Status:
  logMonitor: RUNNING (PID: 12346)
  healthCheck: RUNNING (PID: 12347)
  memoryMonitor: RUNNING (PID: 12348)
  performanceAnalyzer: RUNNING (PID: 12349)

═══════════════════════════════════════════════════════════
```

---

## 🚨 Alerts & Notifications

### Alert Conditions

1. **Memory Alerts**:
   - System memory > 85%
   - Heap usage > 90%
   - Memory leak detected

2. **Performance Alerts**:
   - CPU usage > 80%
   - Load average > 100% (normalized)
   - Consecutive slow responses

3. **Health Alerts**:
   - Server unreachable
   - Database disconnected
   - 3+ consecutive failures

4. **Security Alerts**:
   - Unencrypted PII in logs
   - Multiple failed auth attempts
   - Suspicious patterns detected

---

## 🛠️ Troubleshooting

### Agent Won't Start

```bash
# Check if port is in use
netstat -ano | findstr :5000

# Check logs
cat logs/agents/master.log

# Verify Node.js version
node --version  # Should be >= 14.0.0
```

### High Memory Usage

```bash
# Start memory monitor
npm run agent:memory-monitor

# View recommendations
# Agent will provide optimization tips
```

### Server Health Issues

```bash
# Start health check agent
npm run agent:health-check

# Check specific logs
npm run logs:server
npm run logs:errors
```

---

## 📝 Best Practices

1. **Always Use Encrypted Logging for PII**
   ```javascript
   // ❌ Bad
   console.log(`User: ${user.name}, Phone: ${user.phoneNumber}`);
   
   // ✅ Good
   logServerSafe('info', 'User action', { name: user.name, phoneNumber: user.phoneNumber }, 'mask');
   ```

2. **Run Master Agent in Production**
   - Provides centralized control
   - Automatic monitoring and alerts
   - Easy troubleshooting

3. **Monitor Logs Regularly**
   - Check agent reports daily
   - Review security alerts immediately
   - Analyze performance trends weekly

4. **Set Up Proper Environment Variables**
   - Use strong LOG_ENCRYPTION_KEY
   - Configure alert thresholds
   - Set proper intervals

5. **Keep Agents Running**
   - Use process managers (PM2, systemd)
   - Set up automatic restarts
   - Monitor agent health

---

## 🔄 Updates & Maintenance

### Updating Agents

```bash
# Pull latest changes
git pull

# Restart master agent
npm run master
# Then restart all agents from menu
```

### Log Rotation

Logs are automatically rotated by Winston:
- Max file size: 5MB
- Max files: 5 (server, ai, connections, database)
- Max files: 10 (errors)

### Backup

```bash
# Backup logs
cp -r logs logs_backup_$(date +%Y%m%d)

# Backup configuration
cp .env .env.backup
```

---

## 📞 Support

For issues or questions:
1. Check agent logs in `logs/agents/`
2. Review system health report
3. Check individual agent outputs
4. Review this documentation

---

## 🎯 Roadmap

- [ ] Web-based dashboard
- [ ] Email/SMS alerts
- [ ] Custom alert rules
- [ ] Integration with monitoring services
- [ ] Automated recovery actions
- [ ] Performance profiling
- [ ] Log analytics and visualization

---

## 📄 License

Part of the Syncup Backend System
