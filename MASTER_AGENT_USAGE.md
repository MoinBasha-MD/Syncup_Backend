# 🎮 Master Agent - Quick Reference

## Starting the Master Agent

```bash
npm run master
```

## Navigation Tips

### Viewing Logs (Option 9)
1. Select option `9` from main menu
2. Enter log type: `server`, `ai-communication`, `connections`, `database`, or `errors`
3. View the last 50 lines of logs
4. **Press Enter** to return to the main menu

### Viewing Agent Logs (Option 15)
1. Select option `15` from main menu
2. View master agent logs
3. **Press Enter** to return to the main menu

### Starting Individual Agents (Option 8)
1. Select option `8` from main menu
2. Enter agent name:
   - `logMonitor`
   - `healthCheck`
   - `memoryMonitor`
   - `performanceAnalyzer`
3. Agent starts and you return to menu

## Common Workflows

### Quick Start Everything
```
1. Start Master Agent: npm run master
2. Press 1 → Start Server
3. Press 5 → Start All Agents
4. Press 10 → View System Health
```

### Check Server Status
```
1. Press 4 → Server Status
   OR
2. Press 10 → Full System Health Report
```

### View Recent Errors
```
1. Press 9 → View Live Logs
2. Type: errors
3. Review error logs
4. Press Enter → Return to menu
```

### Monitor Performance
```
Option A: Use Agent
1. Press 11 → Start Memory Monitor
   OR
2. Press 12 → Start Performance Analyzer

Option B: View Logs
1. Press 9 → View Live Logs
2. Type: server
3. Look for performance metrics
4. Press Enter → Return to menu
```

### Restart Server
```
1. Press 3 → Restart Server
   (Automatically stops and starts)
```

### Clean Shutdown
```
1. Press 0 → Exit Master Agent
   (Stops server and all agents)
```

## Log Types Available

| Log Type | Description | What to Look For |
|----------|-------------|------------------|
| `server` | General server operations | Startup, requests, general info |
| `ai-communication` | AI agent messages | AI routing, responses |
| `connections` | Socket.IO events | User connections, disconnections |
| `database` | MongoDB operations | Queries, connection status |
| `errors` | All errors | Exceptions, failures, crashes |

## Keyboard Shortcuts

- **Enter** - Return to main menu (after viewing logs)
- **0** - Exit Master Agent
- **Ctrl+C** - Emergency exit (stops all processes)

## Status Indicators

### Server Status
- 🟢 **RUNNING** - Server is active
- 🔴 **STOPPED** - Server is not running
- 🟡 **STARTING** - Server is initializing

### Agent Status
- 🟢 **RUNNING** - Agent is active (shows PID)
- 🔴 **STOPPED** - Agent is not running
- 🔴 **ERROR** - Agent encountered an error

## Troubleshooting

### Can't Return to Menu After Viewing Logs
**Solution**: Just press Enter key. The prompt is there, waiting for input.

### Menu Not Responding
**Solution**: 
1. Press Ctrl+C to exit
2. Restart with `npm run master`

### Server Won't Start
**Check**:
1. Port 5000 is not in use: `netstat -ano | findstr :5000`
2. MongoDB is running
3. .env file has correct configuration

### Agents Won't Start
**Check**:
1. Agent files exist in `agents/` folder
2. Node.js version >= 14
3. No permission issues

### Logs Not Showing
**Check**:
1. Log files exist in `logs/` folder
2. Server has been running (logs are created on startup)
3. Correct log type name entered

## Pro Tips

### 💡 Tip 1: Regular Health Checks
Press `10` every hour to monitor system health

### 💡 Tip 2: Monitor Errors First
Always check `errors` log type first when troubleshooting

### 💡 Tip 3: Use Agents for Continuous Monitoring
Start all agents (`5`) and let them run in background

### 💡 Tip 4: Clear Old Logs
Use option `13` weekly to clear old log files

### 💡 Tip 5: Check Memory Before Peak Hours
Press `11` to start memory monitor before high traffic

## Example Session

```
# Start Master Agent
$ npm run master

╔════════════════════════════════════════════════════════════════╗
║              🤖 SYNCUP MASTER AGENT CONTROL CENTER             ║
╚════════════════════════════════════════════════════════════════╝

Select an option: 1
🚀 Starting Syncup Server...
✅ Server started successfully

Select an option: 5
🤖 Starting all agents...
✅ logMonitor started
✅ healthCheck started
✅ memoryMonitor started
✅ performanceAnalyzer started

Select an option: 10
═══════════════════════════════════════════════════════════
                  SYSTEM HEALTH REPORT                     
═══════════════════════════════════════════════════════════
System Information:
  Platform: win32
  Node Version: v18.17.0
  
Memory Status:
  Total: 16.00 GB
  Used: 8.50 GB (53.13%)
  
Server Status:
  Status: RUNNING
  PID: 12345
═══════════════════════════════════════════════════════════

Select an option: 9
Log type: server
📋 Viewing server logs (last 50 lines)...

[SERVER] Server started on port 5000
[SERVER] Database connected
[SERVER] User logged in { userId: 'user123' }
...

💡 Tip: Use option 9 to view different log types
Press Enter to return to main menu...
[Press Enter]

Select an option: 0
🛑 Shutting down Master Agent...
✅ Master Agent shutdown complete
```

## Quick Command Reference

| Option | Action | Returns to Menu |
|--------|--------|-----------------|
| 1 | Start Server | ✅ Auto |
| 2 | Stop Server | ✅ Auto |
| 3 | Restart Server | ✅ Auto |
| 4 | Server Status | ✅ Auto |
| 5 | Start All Agents | ✅ Auto |
| 6 | Stop All Agents | ✅ Auto |
| 7 | Agent Status | ✅ Auto |
| 8 | Start Individual Agent | ✅ Auto |
| 9 | View Live Logs | ⏸️ Press Enter |
| 10 | System Health Report | ✅ Auto |
| 11 | Memory Analysis | ✅ Auto |
| 12 | Performance Metrics | ✅ Auto |
| 13 | Clear Logs | ✅ Auto |
| 14 | Backup Config | ✅ Auto |
| 15 | View Agent Logs | ⏸️ Press Enter |
| 0 | Exit | 🛑 Exits |

---

**Need Help?** Check `MASTER_AGENT_README.md` for detailed documentation.
