#!/usr/bin/env node

/**
 * Log Monitor Agent
 * Monitors log files for errors, warnings, and suspicious patterns
 * Reports findings to Master Agent
 */

const fs = require('fs');
const path = require('path');

class LogMonitorAgent {
  constructor() {
    this.logsDir = path.join(__dirname, '../logs');
    this.reportInterval = 60000; // Report every minute
    this.errorCount = 0;
    this.warningCount = 0;
    this.suspiciousPatterns = [];
    
    // Patterns to watch for
    this.patterns = {
      error: /error|exception|failed|crash/i,
      warning: /warning|warn|deprecated/i,
      security: /unauthorized|forbidden|authentication failed|invalid token/i,
      performance: /timeout|slow query|high memory|cpu spike/i,
      pii: /ENC\[|HASH\[|password|token|secret/i
    };
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const colors = {
      info: '\x1b[36m',
      success: '\x1b[32m',
      warning: '\x1b[33m',
      error: '\x1b[31m',
      reset: '\x1b[0m'
    };
    
    console.log(`${colors[type]}[LOG-MONITOR] ${timestamp} - ${message}${colors.reset}`);
  }

  analyzeLine(line, logType) {
    // Check for errors
    if (this.patterns.error.test(line)) {
      this.errorCount++;
      this.log(`Error detected in ${logType}: ${line.substring(0, 100)}`, 'error');
    }
    
    // Check for warnings
    if (this.patterns.warning.test(line)) {
      this.warningCount++;
      this.log(`Warning detected in ${logType}: ${line.substring(0, 100)}`, 'warning');
    }
    
    // Check for security issues
    if (this.patterns.security.test(line)) {
      this.log(`Security event in ${logType}: ${line.substring(0, 100)}`, 'warning');
    }
    
    // Check for performance issues
    if (this.patterns.performance.test(line)) {
      this.log(`Performance issue in ${logType}: ${line.substring(0, 100)}`, 'warning');
    }
    
    // Check for PII encryption
    if (this.patterns.pii.test(line)) {
      if (!line.includes('ENC[') && !line.includes('HASH[')) {
        this.log(`Potential unencrypted PII in ${logType}: ${line.substring(0, 100)}`, 'warning');
      }
    }
  }

  monitorLog(logFile, logType) {
    const logPath = path.join(this.logsDir, logFile);
    
    if (!fs.existsSync(logPath)) {
      this.log(`Log file not found: ${logPath}`, 'warning');
      return;
    }

    this.log(`Monitoring ${logType} log: ${logPath}`, 'success');
    
    // Read existing content
    const existingContent = fs.readFileSync(logPath, 'utf8');
    existingContent.split('\n').forEach(line => {
      if (line.trim()) {
        this.analyzeLine(line, logType);
      }
    });

    // Use polling to watch for new lines
    this.log(`Using polling for ${logType}`, 'info');
    this.pollLog(logPath, logType);
  }

  pollLog(logPath, logType) {
    let lastSize = fs.statSync(logPath).size;
    
    setInterval(() => {
      const currentSize = fs.statSync(logPath).size;
      
      if (currentSize > lastSize) {
        const stream = fs.createReadStream(logPath, {
          start: lastSize,
          end: currentSize
        });
        
        stream.on('data', (chunk) => {
          chunk.toString().split('\n').forEach(line => {
            if (line.trim()) {
              this.analyzeLine(line, logType);
            }
          });
        });
        
        lastSize = currentSize;
      }
    }, 5000); // Check every 5 seconds
  }

  generateReport() {
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    this.log('                    LOG MONITORING REPORT                    ', 'info');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    this.log(`Total Errors: ${this.errorCount}`, this.errorCount > 0 ? 'error' : 'success');
    this.log(`Total Warnings: ${this.warningCount}`, this.warningCount > 0 ? 'warning' : 'success');
    this.log(`Report Time: ${new Date().toISOString()}`, 'info');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    
    // Reset counters
    this.errorCount = 0;
    this.warningCount = 0;
  }

  start() {
    this.log('Starting Log Monitor Agent...', 'success');
    
    // Monitor all log files
    const logFiles = [
      { file: 'server.log', type: 'server' },
      { file: 'ai-communication.log', type: 'ai' },
      { file: 'connections.log', type: 'connections' },
      { file: 'database.log', type: 'database' },
      { file: 'errors.log', type: 'errors' }
    ];

    logFiles.forEach(({ file, type }) => {
      this.monitorLog(file, type);
    });

    // Generate periodic reports
    setInterval(() => {
      this.generateReport();
    }, this.reportInterval);

    this.log('Log Monitor Agent is running', 'success');
  }
}

// Start agent
const agent = new LogMonitorAgent();
agent.start();

// Keep process alive
process.on('SIGINT', () => {
  console.log('\nLog Monitor Agent shutting down...');
  process.exit(0);
});
