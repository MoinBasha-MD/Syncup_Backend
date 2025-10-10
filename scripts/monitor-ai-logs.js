#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  🤖 AI COMMUNICATION MONITOR                 ║
║                                                              ║
║  Monitoring AI-to-AI communications, routing, and messages  ║
║  Press Ctrl+C to exit                                       ║
╚══════════════════════════════════════════════════════════════╝
`);

const logFile = path.join(__dirname, '../logs/ai-communication.log');

// Create log file if it doesn't exist
if (!fs.existsSync(logFile)) {
  fs.writeFileSync(logFile, '');
}

// Watch for changes in the AI log file
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
              const service = logEntry.service || 'AI';
              
              // Color coding for different log levels
              let colorCode = '';
              switch (level) {
                case 'ERROR': colorCode = '\x1b[31m'; break; // Red
                case 'WARN': colorCode = '\x1b[33m'; break;  // Yellow
                case 'INFO': colorCode = '\x1b[36m'; break;  // Cyan
                case 'DEBUG': colorCode = '\x1b[37m'; break; // White
                default: colorCode = '\x1b[0m'; // Reset
              }
              
              console.log(`${colorCode}🤖 ${timestamp} [${level}] ${message}\x1b[0m`);
              
              // Show additional metadata if present
              if (logEntry.aiId || logEntry.messageId || logEntry.conversationId) {
                const meta = [];
                if (logEntry.aiId) meta.push(`AI: ${logEntry.aiId}`);
                if (logEntry.messageId) meta.push(`Msg: ${logEntry.messageId}`);
                if (logEntry.conversationId) meta.push(`Conv: ${logEntry.conversationId}`);
                console.log(`   📋 ${meta.join(' | ')}`);
              }
            } catch (e) {
              // If not JSON, just print the line
              if (line.trim()) {
                console.log(`🤖 ${line}`);
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
  console.log('\n\n🤖 AI Communication Monitor stopped.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n🤖 AI Communication Monitor terminated.');
  process.exit(0);
});
