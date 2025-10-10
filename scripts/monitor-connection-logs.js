#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   🔌 CONNECTION MONITOR                      ║
║                                                              ║
║  Monitoring Socket.IO connections, disconnections, and      ║
║  real-time communication events                             ║
║  Press Ctrl+C to exit                                       ║
╚══════════════════════════════════════════════════════════════╝
`);

const logFile = path.join(__dirname, '../logs/connections.log');

// Create log file if it doesn't exist
if (!fs.existsSync(logFile)) {
  fs.writeFileSync(logFile, '');
}

// Watch for changes in the connection log file
let lastSize = 0;

const watchLogs = () => {
  try {
    const stats = fs.statSync(logFile);
    if (stats.size > lastSize) {
      const stream = fs.createReadStream(logFile, {
        start: lastSize,
        end: stats.size
      });
      
      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer
        
        lines.forEach(line => {
          if (line.trim()) {
            try {
              const logEntry = JSON.parse(line);
              const timestamp = new Date(logEntry.timestamp).toLocaleTimeString();
              const level = logEntry.level.toUpperCase();
              const message = logEntry.message;
              
              // Color coding for different log levels
              let colorCode = '';
              switch (level) {
                case 'ERROR': colorCode = '\x1b[31m'; break; // Red
                case 'WARN': colorCode = '\x1b[33m'; break;  // Yellow
                case 'INFO': colorCode = '\x1b[32m'; break;  // Green
                case 'DEBUG': colorCode = '\x1b[37m'; break; // White
                default: colorCode = '\x1b[0m'; // Reset
              }
              
              console.log(`${colorCode}🔌 ${timestamp} [${level}] ${message}\x1b[0m`);
              
              // Show connection details if present
              if (logEntry.socketId || logEntry.userId || logEntry.aiId) {
                const meta = [];
                if (logEntry.socketId) meta.push(`Socket: ${logEntry.socketId.substring(0, 8)}...`);
                if (logEntry.userId) meta.push(`User: ${logEntry.userId}`);
                if (logEntry.aiId) meta.push(`AI: ${logEntry.aiId}`);
                console.log(`   🔗 ${meta.join(' | ')}`);
              }
            } catch (e) {
              // If not JSON, just print the line
              if (line.trim()) {
                console.log(`🔌 ${line}`);
              }
            }
          }
        });
      });
      
      lastSize = stats.size;
    }
  } catch (error) {
    // File might not exist yet, ignore
  }
};

// Initial read
watchLogs();

// Watch for changes every 500ms
setInterval(watchLogs, 500);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🔌 Connection Monitor stopped.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n🔌 Connection Monitor terminated.');
  process.exit(0);
});
