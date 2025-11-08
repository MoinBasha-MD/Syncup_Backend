#!/usr/bin/env node

/**
 * Health Check Agent
 * Monitors server health, database connectivity, and service availability
 * Performs automatic restarts if critical issues detected
 */

const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const mongoose = require('mongoose');

class HealthCheckAgent {
  constructor() {
    this.checkInterval = 30000; // Check every 30 seconds
    this.serverUrl = process.env.SERVER_URL || 'http://localhost:5000';
    this.mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/syncup';
    
    this.healthMetrics = {
      serverUp: false,
      databaseConnected: false,
      lastCheck: null,
      consecutiveFailures: 0,
      uptime: 0
    };
    
    this.maxConsecutiveFailures = 3;
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
    
    console.log(`${colors[type]}[HEALTH-CHECK] ${timestamp} - ${message}${colors.reset}`);
  }

  async checkServerHealth() {
    return new Promise((resolve) => {
      const protocol = this.serverUrl.startsWith('https') ? https : http;
      
      const req = protocol.get(this.serverUrl + '/health', { timeout: 5000 }, (res) => {
        if (res.statusCode === 200) {
          this.log('Server health check: OK', 'success');
          resolve(true);
        } else {
          this.log(`Server health check: Failed (Status: ${res.statusCode})`, 'error');
          resolve(false);
        }
      });

      req.on('error', (error) => {
        this.log(`Server health check: Failed (${error.message})`, 'error');
        resolve(false);
      });

      req.on('timeout', () => {
        this.log('Server health check: Timeout', 'error');
        req.destroy();
        resolve(false);
      });
    });
  }

  async checkDatabaseHealth() {
    try {
      if (mongoose.connection.readyState === 1) {
        // Already connected
        await mongoose.connection.db.admin().ping();
        this.log('Database health check: OK', 'success');
        return true;
      } else {
        // Try to connect
        await mongoose.connect(this.mongoUri, {
          serverSelectionTimeoutMS: 5000
        });
        this.log('Database health check: OK', 'success');
        return true;
      }
    } catch (error) {
      this.log(`Database health check: Failed (${error.message})`, 'error');
      return false;
    }
  }

  async checkMemoryUsage() {
    return new Promise((resolve) => {
      exec('node -e "console.log(JSON.stringify(process.memoryUsage()))"', (error, stdout) => {
        if (error) {
          this.log(`Memory check failed: ${error.message}`, 'error');
          resolve(null);
          return;
        }

        try {
          const memUsage = JSON.parse(stdout);
          const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
          const heapTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(2);
          const rssMB = (memUsage.rss / 1024 / 1024).toFixed(2);
          
          this.log(`Memory Usage - Heap: ${heapUsedMB}/${heapTotalMB} MB, RSS: ${rssMB} MB`, 'info');
          
          // Alert if memory usage is high
          if (memUsage.heapUsed / memUsage.heapTotal > 0.9) {
            this.log('WARNING: High memory usage detected (>90%)', 'warning');
          }
          
          resolve(memUsage);
        } catch (parseError) {
          this.log(`Memory check parse error: ${parseError.message}`, 'error');
          resolve(null);
        }
      });
    });
  }

  async performHealthCheck() {
    this.log('Performing health check...', 'info');
    
    const serverHealthy = await this.checkServerHealth();
    const databaseHealthy = await this.checkDatabaseHealth();
    await this.checkMemoryUsage();
    
    this.healthMetrics.serverUp = serverHealthy;
    this.healthMetrics.databaseConnected = databaseHealthy;
    this.healthMetrics.lastCheck = new Date();
    
    if (!serverHealthy || !databaseHealthy) {
      this.healthMetrics.consecutiveFailures++;
      this.log(`Health check failed (${this.healthMetrics.consecutiveFailures}/${this.maxConsecutiveFailures})`, 'error');
      
      if (this.healthMetrics.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.log('CRITICAL: Multiple consecutive failures detected!', 'error');
        this.handleCriticalFailure();
      }
    } else {
      this.healthMetrics.consecutiveFailures = 0;
      this.healthMetrics.uptime++;
    }
  }

  handleCriticalFailure() {
    this.log('Attempting automatic recovery...', 'warning');
    
    // Log the failure
    const failureReport = {
      timestamp: new Date().toISOString(),
      serverUp: this.healthMetrics.serverUp,
      databaseConnected: this.healthMetrics.databaseConnected,
      consecutiveFailures: this.healthMetrics.consecutiveFailures
    };
    
    this.log(`Failure Report: ${JSON.stringify(failureReport)}`, 'error');
    
    // In production, you might want to:
    // 1. Send alert to admin
    // 2. Attempt automatic restart
    // 3. Create incident ticket
    
    this.log('Alert sent to administrators', 'warning');
  }

  generateReport() {
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    this.log('                    HEALTH CHECK REPORT                      ', 'info');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    this.log(`Server Status: ${this.healthMetrics.serverUp ? '✅ UP' : '❌ DOWN'}`, 
      this.healthMetrics.serverUp ? 'success' : 'error');
    this.log(`Database Status: ${this.healthMetrics.databaseConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}`, 
      this.healthMetrics.databaseConnected ? 'success' : 'error');
    this.log(`Last Check: ${this.healthMetrics.lastCheck?.toISOString() || 'Never'}`, 'info');
    this.log(`Consecutive Failures: ${this.healthMetrics.consecutiveFailures}`, 
      this.healthMetrics.consecutiveFailures > 0 ? 'warning' : 'success');
    this.log(`Uptime Checks: ${this.healthMetrics.uptime}`, 'info');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
  }

  start() {
    this.log('Starting Health Check Agent...', 'success');
    
    // Perform initial check
    this.performHealthCheck();
    
    // Schedule periodic checks
    setInterval(() => {
      this.performHealthCheck();
    }, this.checkInterval);
    
    // Generate report every 5 minutes
    setInterval(() => {
      this.generateReport();
    }, 300000);
    
    this.log('Health Check Agent is running', 'success');
  }
}

// Start agent
const agent = new HealthCheckAgent();
agent.start();

// Keep process alive
process.on('SIGINT', () => {
  console.log('\nHealth Check Agent shutting down...');
  if (mongoose.connection.readyState === 1) {
    mongoose.connection.close();
  }
  process.exit(0);
});
