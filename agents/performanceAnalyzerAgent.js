#!/usr/bin/env node

/**
 * Performance Analyzer Agent
 * Analyzes server performance metrics, response times, and throughput
 * Provides optimization recommendations
 */

const os = require('os');
const { exec } = require('child_process');

class PerformanceAnalyzerAgent {
  constructor() {
    this.checkInterval = 15000; // Check every 15 seconds
    this.metrics = {
      cpu: [],
      loadAverage: [],
      responseTime: [],
      throughput: []
    };
    this.maxHistorySize = 50;
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
    
    console.log(`${colors[type]}[PERFORMANCE] ${timestamp} - ${message}${colors.reset}`);
  }

  getCPUUsage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (let type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - ~~(100 * idle / total);

    return {
      usage: usage.toFixed(2),
      cores: cpus.length,
      model: cpus[0].model,
      speed: cpus[0].speed,
      timestamp: Date.now()
    };
  }

  getLoadAverage() {
    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;

    return {
      '1min': loadAvg[0].toFixed(2),
      '5min': loadAvg[1].toFixed(2),
      '15min': loadAvg[2].toFixed(2),
      normalized1min: (loadAvg[0] / cpuCount * 100).toFixed(2),
      cpuCount,
      timestamp: Date.now()
    };
  }

  async getNetworkStats() {
    return new Promise((resolve) => {
      exec('netstat -e', (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        try {
          const lines = stdout.split('\n');
          const stats = {};
          
          lines.forEach(line => {
            if (line.includes('Bytes')) {
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 3) {
                stats.received = parts[1];
                stats.sent = parts[2];
              }
            }
          });

          resolve(stats);
        } catch (parseError) {
          resolve(null);
        }
      });
    });
  }

  analyzeCPUTrend() {
    if (this.metrics.cpu.length < 5) {
      return 'insufficient_data';
    }

    const recent = this.metrics.cpu.slice(-5);
    const avgUsage = recent.reduce((sum, item) => sum + parseFloat(item.usage), 0) / recent.length;

    if (avgUsage > 90) return 'critical';
    if (avgUsage > 75) return 'high';
    if (avgUsage > 50) return 'moderate';
    return 'normal';
  }

  analyzeLoadTrend() {
    if (this.metrics.loadAverage.length < 5) {
      return 'insufficient_data';
    }

    const recent = this.metrics.loadAverage.slice(-5);
    const avgLoad = recent.reduce((sum, item) => sum + parseFloat(item.normalized1min), 0) / recent.length;

    if (avgLoad > 100) return 'overloaded';
    if (avgLoad > 80) return 'high';
    if (avgLoad > 50) return 'moderate';
    return 'normal';
  }

  async performPerformanceCheck() {
    // Collect CPU metrics
    const cpuMetrics = this.getCPUUsage();
    this.metrics.cpu.push(cpuMetrics);
    if (this.metrics.cpu.length > this.maxHistorySize) {
      this.metrics.cpu.shift();
    }

    // Collect load average
    const loadMetrics = this.getLoadAverage();
    this.metrics.loadAverage.push(loadMetrics);
    if (this.metrics.loadAverage.length > this.maxHistorySize) {
      this.metrics.loadAverage.shift();
    }

    // Log current metrics
    this.log(`CPU Usage: ${cpuMetrics.usage}% (${cpuMetrics.cores} cores)`, 
      parseFloat(cpuMetrics.usage) > 80 ? 'warning' : 'info');
    
    this.log(`Load Average: ${loadMetrics['1min']} / ${loadMetrics['5min']} / ${loadMetrics['15min']} (normalized: ${loadMetrics.normalized1min}%)`, 
      parseFloat(loadMetrics.normalized1min) > 80 ? 'warning' : 'info');

    // Analyze trends
    const cpuTrend = this.analyzeCPUTrend();
    const loadTrend = this.analyzeLoadTrend();

    if (cpuTrend === 'critical' || cpuTrend === 'high') {
      this.log(`CPU Trend: ${cpuTrend.toUpperCase()}`, 'warning');
    }

    if (loadTrend === 'overloaded' || loadTrend === 'high') {
      this.log(`Load Trend: ${loadTrend.toUpperCase()}`, 'warning');
    }

    // Get network stats
    const networkStats = await this.getNetworkStats();
    if (networkStats) {
      this.log(`Network - Received: ${networkStats.received} bytes, Sent: ${networkStats.sent} bytes`, 'info');
    }
  }

  generateReport() {
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    this.log('                 PERFORMANCE ANALYSIS REPORT                 ', 'info');
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    
    // CPU Analysis
    if (this.metrics.cpu.length > 0) {
      const latestCPU = this.metrics.cpu[this.metrics.cpu.length - 1];
      const avgCPU = this.metrics.cpu.reduce((sum, item) => 
        sum + parseFloat(item.usage), 0) / this.metrics.cpu.length;
      const maxCPU = Math.max(...this.metrics.cpu.map(item => parseFloat(item.usage)));
      
      this.log(`CPU - Current: ${latestCPU.usage}%, Average: ${avgCPU.toFixed(2)}%, Peak: ${maxCPU.toFixed(2)}%`, 'info');
      this.log(`CPU Trend: ${this.analyzeCPUTrend().toUpperCase()}`, 'info');
    }
    
    // Load Average Analysis
    if (this.metrics.loadAverage.length > 0) {
      const latestLoad = this.metrics.loadAverage[this.metrics.loadAverage.length - 1];
      this.log(`Load Average: 1min=${latestLoad['1min']}, 5min=${latestLoad['5min']}, 15min=${latestLoad['15min']}`, 'info');
      this.log(`Load Trend: ${this.analyzeLoadTrend().toUpperCase()}`, 'info');
    }
    
    // System Info
    this.log(`System Uptime: ${Math.floor(os.uptime() / 3600)} hours`, 'info');
    this.log(`Free Memory: ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`, 'info');
    
    this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
  }

  provideOptimizationRecommendations() {
    const cpuTrend = this.analyzeCPUTrend();
    const loadTrend = this.analyzeLoadTrend();
    
    if (cpuTrend === 'critical' || cpuTrend === 'high' || loadTrend === 'overloaded' || loadTrend === 'high') {
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'warning');
      this.log('           PERFORMANCE OPTIMIZATION RECOMMENDATIONS          ', 'warning');
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'warning');
      
      if (cpuTrend === 'critical' || cpuTrend === 'high') {
        this.log('CPU Optimization:', 'warning');
        this.log('  • Enable clustering to distribute load across cores', 'warning');
        this.log('  • Optimize database queries and add indexes', 'warning');
        this.log('  • Implement caching for frequently accessed data', 'warning');
        this.log('  • Review and optimize CPU-intensive operations', 'warning');
      }
      
      if (loadTrend === 'overloaded' || loadTrend === 'high') {
        this.log('Load Optimization:', 'warning');
        this.log('  • Consider horizontal scaling (add more servers)', 'warning');
        this.log('  • Implement rate limiting to prevent overload', 'warning');
        this.log('  • Use load balancer to distribute traffic', 'warning');
        this.log('  • Optimize background tasks and schedulers', 'warning');
      }
      
      this.log('General Recommendations:', 'warning');
      this.log('  • Enable compression middleware', 'warning');
      this.log('  • Use CDN for static assets', 'warning');
      this.log('  • Implement Redis caching', 'warning');
      this.log('  • Review and optimize socket connections', 'warning');
      this.log('  • Monitor and optimize database connection pool', 'warning');
      
      this.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'warning');
    }
  }

  start() {
    this.log('Starting Performance Analyzer Agent...', 'success');
    
    // Perform initial check
    this.performPerformanceCheck();
    
    // Schedule periodic checks
    setInterval(() => {
      this.performPerformanceCheck();
    }, this.checkInterval);
    
    // Generate report every 3 minutes
    setInterval(() => {
      this.generateReport();
      this.provideOptimizationRecommendations();
    }, 180000);
    
    this.log('Performance Analyzer Agent is running', 'success');
  }
}

// Start agent
const agent = new PerformanceAnalyzerAgent();
agent.start();

// Keep process alive
process.on('SIGINT', () => {
  console.log('\nPerformance Analyzer Agent shutting down...');
  process.exit(0);
});
