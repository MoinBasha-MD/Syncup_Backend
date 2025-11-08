#!/usr/bin/env node

/**
 * Memory Monitor Agent
 * Tracks memory usage, detects leaks, and provides optimization recommendations
 */

const os = require('os');
const { exec } = require('child_process');
const config = require('./agentConfig');

class MemoryMonitorAgent {
  constructor() {
    this.checkInterval = config.memoryMonitor.checkInterval;
    this.memoryHistory = [];
    this.maxHistorySize = 100;
    this.alertThreshold = config.memoryMonitor.alertThreshold;
    this.reportInterval = config.memoryMonitor.reportInterval;
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
    
    console.log(`${colors[type]}[MEMORY-MONITOR] ${timestamp} - ${message}${colors.reset}`);
  }

  getSystemMemory() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const usagePercent = (usedMem / totalMem) * 100;

    return {
      total: (totalMem / 1024 / 1024 / 1024).toFixed(2),
      used: (usedMem / 1024 / 1024 / 1024).toFixed(2),
      free: (freeMem / 1024 / 1024 / 1024).toFixed(2),
      usagePercent: usagePercent.toFixed(2),
      timestamp: Date.now()
    };
  }

  async getProcessMemory() {
    return new Promise((resolve) => {
      // Get Node.js process memory
      const nodeMemory = process.memoryUsage();
      
      // Try to get server process memory
      exec('tasklist /FI "IMAGENAME eq node.exe" /FO CSV', (error, stdout) => {
        let serverMemory = null;
        
        if (!error) {
          const lines = stdout.split('\n');
          // Parse CSV output to find memory usage
          lines.forEach(line => {
            if (line.includes('node.exe')) {
              const parts = line.split(',');
              if (parts.length >= 5) {
                const memStr = parts[4].replace(/"/g, '').replace(/[^\d]/g, '');
                serverMemory = parseInt(memStr) || null;
              }
            }
          });
        }

        resolve({
          node: {
            rss: (nodeMemory.rss / 1024 / 1024).toFixed(2),
            heapTotal: (nodeMemory.heapTotal / 1024 / 1024).toFixed(2),
            heapUsed: (nodeMemory.heapUsed / 1024 / 1024).toFixed(2),
            external: (nodeMemory.external / 1024 / 1024).toFixed(2),
            heapUsagePercent: ((nodeMemory.heapUsed / nodeMemory.heapTotal) * 100).toFixed(2)
          },
          server: serverMemory ? (serverMemory / 1024).toFixed(2) : 'N/A'
        });
      });
    });
  }

  detectMemoryLeak() {
    if (this.memoryHistory.length < 10) {
      return false;
    }

    // Check if memory is consistently increasing
    const recentHistory = this.memoryHistory.slice(-10);
    let increasing = true;
    
    for (let i = 1; i < recentHistory.length; i++) {
      if (recentHistory[i].usagePercent <= recentHistory[i - 1].usagePercent) {
        increasing = false;
        break;
      }
    }

    if (increasing) {
      const increase = recentHistory[recentHistory.length - 1].usagePercent - recentHistory[0].usagePercent;
      if (increase > config.memoryMonitor.leakDetectionIncrease) {
        this.log(`MEMORY LEAK DETECTED: ${increase.toFixed(2)}% increase over last ${recentHistory.length} checks`, 'error');
        return true;
      }
    }

    return false;
  }

  analyzeMemoryTrend() {
    if (this.memoryHistory.length < 5) {
      return 'insufficient_data';
    }

    const recent = this.memoryHistory.slice(-5);
    const avgUsage = recent.reduce((sum, item) => sum + parseFloat(item.usagePercent), 0) / recent.length;

    if (avgUsage > config.memoryMonitor.criticalThreshold * 100) return 'critical';
    if (avgUsage > config.memoryMonitor.highThreshold * 100) return 'high';
    if (avgUsage > config.memoryMonitor.moderateThreshold * 100) return 'moderate';
    return 'normal';
  }

  async performMemoryCheck() {
    const systemMem = this.getSystemMemory();
    const processMem = await this.getProcessMemory();

    // Store in history
    this.memoryHistory.push(systemMem);
    if (this.memoryHistory.length > this.maxHistorySize) {
      this.memoryHistory.shift();
    }

    // Log current status
    this.log(`System Memory: ${systemMem.used}GB / ${systemMem.total}GB (${systemMem.usagePercent}%)`, 
      parseFloat(systemMem.usagePercent) > this.alertThreshold * 100 ? 'warning' : 'info');
    
    this.log(`Node Process - Heap: ${processMem.node.heapUsed}MB / ${processMem.node.heapTotal}MB (${processMem.node.heapUsagePercent}%)`, 'info');

    // Check for alerts
    if (parseFloat(systemMem.usagePercent) > this.alertThreshold * 100) {
      this.log(`WARNING: System memory usage above ${this.alertThreshold * 100}%`, 'warning');
    }

    if (parseFloat(processMem.node.heapUsagePercent) > 90) {
      this.log('WARNING: Node.js heap usage above 90%', 'warning');
    }

    // Detect memory leaks
    this.detectMemoryLeak();

    // Analyze trend
    const trend = this.analyzeMemoryTrend();
    if (trend === 'critical' || trend === 'high') {
      this.log(`Memory trend: ${trend.toUpperCase()}`, 'warning');
    }
  }

  generateReport() {
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    this.log('                   MEMORY ANALYSIS REPORT                    ', 'info');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    
    if (this.memoryHistory.length > 0) {
      const latest = this.memoryHistory[this.memoryHistory.length - 1];
      const trend = this.analyzeMemoryTrend();
      
      this.log(`Current System Memory: ${latest.used}GB / ${latest.total}GB (${latest.usagePercent}%)`, 'info');
      this.log(`Memory Trend: ${trend.toUpperCase()}`, trend === 'critical' ? 'error' : 'info');
      
      // Calculate average over history
      const avgUsage = this.memoryHistory.reduce((sum, item) => 
        sum + parseFloat(item.usagePercent), 0) / this.memoryHistory.length;
      this.log(`Average Usage (last ${this.memoryHistory.length} checks): ${avgUsage.toFixed(2)}%`, 'info');
      
      // Find peak usage
      const peakUsage = Math.max(...this.memoryHistory.map(item => parseFloat(item.usagePercent)));
      this.log(`Peak Usage: ${peakUsage.toFixed(2)}%`, 'info');
    } else {
      this.log('No memory data collected yet', 'warning');
    }
    
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
  }

  provideOptimizationTips() {
    const trend = this.analyzeMemoryTrend();
    
    if (trend === 'critical' || trend === 'high') {
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'warning');
      this.log('              MEMORY OPTIMIZATION RECOMMENDATIONS            ', 'warning');
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'warning');
      this.log('1. Check for memory leaks in long-running processes', 'warning');
      this.log('2. Implement proper cleanup in event listeners', 'warning');
      this.log('3. Use streaming for large data processing', 'warning');
      this.log('4. Clear unused caches and temporary data', 'warning');
      this.log('5. Consider increasing server memory allocation', 'warning');
      this.log('6. Review database connection pooling settings', 'warning');
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'warning');
    }
  }

  start() {
    this.log('Starting Memory Monitor Agent...', 'success');
    
    // Perform initial check
    this.performMemoryCheck();
    
    // Schedule periodic checks
    setInterval(() => {
      this.performMemoryCheck();
    }, this.checkInterval);
    
    // Generate report based on config
    setInterval(() => {
      this.generateReport();
      this.provideOptimizationTips();
    }, this.reportInterval);
    
    this.log('Memory Monitor Agent is running', 'success');
  }
}

// Start agent
const agent = new MemoryMonitorAgent();
agent.start();

// Keep process alive
process.on('SIGINT', () => {
  console.log('\nMemory Monitor Agent shutting down...');
  process.exit(0);
});
