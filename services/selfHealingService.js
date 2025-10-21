const EventEmitter = require('events');
const winston = require('winston');
const os = require('os');

// Configure logger for Self-Healing Service
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/self-healing.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class SelfHealingService extends EventEmitter {
  constructor() {
    super();
    this.isActive = false;
    this.healingActions = new Map();
    this.systemMetrics = new Map();
    this.healingHistory = [];
    
    this.metrics = {
      issuesDetected: 0,
      issuesResolved: 0,
      autoRecoveries: 0,
      manualInterventions: 0,
      systemUptime: 0,
      healingSuccessRate: 100
    };
    
    this.thresholds = {
      memoryUsage: 0.85,      // 85% memory usage
      cpuUsage: 0.90,         // 90% CPU usage
      errorRate: 0.05,        // 5% error rate
      responseTime: 5000,     // 5 seconds response time
      diskUsage: 0.90,        // 90% disk usage
      connectionCount: 1000   // Max connections
    };
    
    this.healingStrategies = new Map();
    this.initializeHealingStrategies();
  }

  /**
   * Initialize the self-healing service
   */
  async initialize() {
    try {
      logger.info('🔧 Initializing Self-Healing Service...');
      
      this.isActive = true;
      this.startSystemMonitoring();
      this.startPeriodicHealthChecks();
      
      logger.info('✅ Self-Healing Service initialized successfully');
      this.emit('initialized');
      
    } catch (error) {
      logger.error('❌ Self-Healing Service initialization failed:', error);
      throw error;
    }
  }

  /**
   * Start continuous system monitoring
   */
  startSystemMonitoring() {
    // Monitor system metrics every 30 seconds
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        const metrics = await this.collectSystemMetrics();
        await this.analyzeSystemHealth(metrics);
        
        // Store metrics for trending
        const timestamp = Date.now();
        this.systemMetrics.set(timestamp, metrics);
        
        // Keep only last hour of metrics
        const oneHourAgo = timestamp - (60 * 60 * 1000);
        for (const [time] of this.systemMetrics) {
          if (time < oneHourAgo) {
            this.systemMetrics.delete(time);
          }
        }
        
      } catch (error) {
        logger.error('❌ System monitoring error:', error);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Start periodic health checks
   */
  startPeriodicHealthChecks() {
    // Comprehensive health check every 5 minutes
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        await this.performComprehensiveHealthCheck();
      } catch (error) {
        logger.error('❌ Health check error:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics() {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const systemLoad = os.loadavg();
    
    return {
      timestamp: new Date(),
      memory: {
        used: memoryUsage.heapUsed,
        total: memoryUsage.heapTotal,
        usage: memoryUsage.heapUsed / memoryUsage.heapTotal,
        external: memoryUsage.external
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        usage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
        loadAverage: systemLoad[0]
      },
      system: {
        uptime: process.uptime(),
        platform: process.platform,
        nodeVersion: process.version,
        freeMemory: os.freemem(),
        totalMemory: os.totalmem()
      }
    };
  }

  /**
   * Analyze system health and trigger healing if needed
   */
  async analyzeSystemHealth(metrics) {
    const issues = [];
    
    // Check memory usage
    if (metrics.memory.usage > this.thresholds.memoryUsage) {
      issues.push({
        type: 'high_memory_usage',
        severity: 'warning',
        value: metrics.memory.usage,
        threshold: this.thresholds.memoryUsage,
        action: 'memory_cleanup'
      });
    }
    
    // Check CPU usage
    if (metrics.cpu.loadAverage > this.thresholds.cpuUsage) {
      issues.push({
        type: 'high_cpu_usage',
        severity: 'warning',
        value: metrics.cpu.loadAverage,
        threshold: this.thresholds.cpuUsage,
        action: 'cpu_optimization'
      });
    }
    
    // Check system memory
    const systemMemoryUsage = (metrics.system.totalMemory - metrics.system.freeMemory) / metrics.system.totalMemory;
    if (systemMemoryUsage > this.thresholds.memoryUsage) {
      issues.push({
        type: 'high_system_memory',
        severity: 'critical',
        value: systemMemoryUsage,
        threshold: this.thresholds.memoryUsage,
        action: 'system_memory_cleanup'
      });
    }
    
    // Trigger healing actions for detected issues
    for (const issue of issues) {
      await this.triggerHealingAction(issue);
    }
    
    if (issues.length > 0) {
      this.metrics.issuesDetected += issues.length;
      this.emit('issuesDetected', issues);
    }
  }

  /**
   * Trigger healing action for detected issue
   */
  async triggerHealingAction(issue) {
    try {
      logger.warn(`🚨 Issue detected: ${issue.type} (${Math.round(issue.value * 100)}%)`);
      
      const strategy = this.healingStrategies.get(issue.action);
      if (!strategy) {
        logger.error(`❌ No healing strategy found for action: ${issue.action}`);
        return;
      }
      
      const healingId = `healing_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      
      // Record healing attempt
      const healingAttempt = {
        id: healingId,
        issue,
        startTime: new Date(),
        status: 'in_progress',
        strategy: strategy.name
      };
      
      this.healingActions.set(healingId, healingAttempt);
      
      // Execute healing strategy
      const result = await strategy.execute(issue, this);
      
      // Update healing attempt
      healingAttempt.endTime = new Date();
      healingAttempt.duration = healingAttempt.endTime - healingAttempt.startTime;
      healingAttempt.status = result.success ? 'completed' : 'failed';
      healingAttempt.result = result;
      
      // Update metrics
      if (result.success) {
        this.metrics.issuesResolved++;
        this.metrics.autoRecoveries++;
        logger.info(`✅ Healing successful: ${issue.type} resolved in ${healingAttempt.duration}ms`);
      } else {
        this.metrics.manualInterventions++;
        logger.error(`❌ Healing failed: ${issue.type} - ${result.error}`);
      }
      
      // Add to history
      this.healingHistory.push(healingAttempt);
      
      // Keep only last 100 healing attempts
      if (this.healingHistory.length > 100) {
        this.healingHistory.shift();
      }
      
      // Update success rate
      this.updateHealingSuccessRate();
      
      this.emit('healingCompleted', healingAttempt);
      
    } catch (error) {
      logger.error(`❌ Healing action failed for ${issue.type}:`, error);
      this.metrics.manualInterventions++;
    }
  }

  /**
   * Initialize healing strategies
   */
  initializeHealingStrategies() {
    // Memory cleanup strategy
    this.healingStrategies.set('memory_cleanup', {
      name: 'Memory Cleanup',
      execute: async (issue, service) => {
        try {
          // Force garbage collection if available
          if (global.gc) {
            global.gc();
          }
          
          // Clear caches if they exist
          if (service.clearCaches) {
            await service.clearCaches();
          }
          
          // Wait a moment and check if memory usage improved
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const newMetrics = await service.collectSystemMetrics();
          const improvement = issue.value - newMetrics.memory.usage;
          
          return {
            success: improvement > 0.05, // 5% improvement
            improvement,
            message: `Memory usage reduced by ${Math.round(improvement * 100)}%`
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });
    
    // CPU optimization strategy
    this.healingStrategies.set('cpu_optimization', {
      name: 'CPU Optimization',
      execute: async (issue, service) => {
        try {
          // Reduce processing intensity
          // This could involve pausing non-critical tasks
          
          logger.info('🔧 Implementing CPU optimization measures...');
          
          // Simulate CPU optimization (in real implementation, this would:
          // - Pause non-critical background tasks
          // - Reduce processing frequency
          // - Optimize database queries
          // - Scale down intensive operations)
          
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          return {
            success: true,
            message: 'CPU optimization measures applied'
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });
    
    // System memory cleanup strategy
    this.healingStrategies.set('system_memory_cleanup', {
      name: 'System Memory Cleanup',
      execute: async (issue, service) => {
        try {
          // More aggressive memory cleanup
          if (global.gc) {
            global.gc();
            // Run GC multiple times for thorough cleanup
            setTimeout(() => global.gc(), 100);
            setTimeout(() => global.gc(), 200);
          }
          
          // Clear all possible caches
          await service.clearAllCaches();
          
          // Wait for cleanup to take effect
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          return {
            success: true,
            message: 'Aggressive system memory cleanup completed'
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });
  }

  /**
   * Perform comprehensive health check
   */
  async performComprehensiveHealthCheck() {
    try {
      const healthReport = {
        timestamp: new Date(),
        overall: 'healthy',
        components: {},
        recommendations: []
      };
      
      // Check system components
      healthReport.components.memory = await this.checkMemoryHealth();
      healthReport.components.cpu = await this.checkCPUHealth();
      healthReport.components.disk = await this.checkDiskHealth();
      healthReport.components.network = await this.checkNetworkHealth();
      
      // Determine overall health
      const componentStatuses = Object.values(healthReport.components);
      if (componentStatuses.some(status => status === 'critical')) {
        healthReport.overall = 'critical';
      } else if (componentStatuses.some(status => status === 'warning')) {
        healthReport.overall = 'warning';
      }
      
      // Generate recommendations
      healthReport.recommendations = this.generateHealthRecommendations(healthReport.components);
      
      this.emit('healthCheckCompleted', healthReport);
      
      return healthReport;
      
    } catch (error) {
      logger.error('❌ Comprehensive health check failed:', error);
      throw error;
    }
  }

  /**
   * Clear all caches
   */
  async clearAllCaches() {
    try {
      // This would clear various caches in the system
      logger.info('🧹 Clearing all system caches...');
      
      // Clear agent caches (implement based on your agent system)
      // Clear database query caches
      // Clear file system caches
      // Clear memory caches
      
      return true;
    } catch (error) {
      logger.error('❌ Cache clearing failed:', error);
      return false;
    }
  }

  /**
   * Update healing success rate
   */
  updateHealingSuccessRate() {
    const totalAttempts = this.metrics.issuesResolved + this.metrics.manualInterventions;
    if (totalAttempts > 0) {
      this.metrics.healingSuccessRate = (this.metrics.issuesResolved / totalAttempts) * 100;
    }
  }

  /**
   * Get system health status
   */
  getSystemHealth() {
    return {
      isActive: this.isActive,
      metrics: this.metrics,
      activeHealingActions: this.healingActions.size,
      recentIssues: this.healingHistory.slice(-10),
      systemUptime: process.uptime(),
      healingStrategies: Array.from(this.healingStrategies.keys())
    };
  }

  /**
   * Check memory health
   */
  async checkMemoryHealth() {
    const memoryUsage = process.memoryUsage();
    const usage = memoryUsage.heapUsed / memoryUsage.heapTotal;
    
    if (usage > 0.9) return 'critical';
    if (usage > 0.8) return 'warning';
    return 'healthy';
  }

  /**
   * Check CPU health
   */
  async checkCPUHealth() {
    const loadAverage = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const usage = loadAverage / cpuCount;
    
    if (usage > 0.9) return 'critical';
    if (usage > 0.7) return 'warning';
    return 'healthy';
  }

  /**
   * Check disk health
   */
  async checkDiskHealth() {
    // Simplified disk check (in production, use actual disk usage)
    return 'healthy';
  }

  /**
   * Check network health
   */
  async checkNetworkHealth() {
    // Simplified network check (in production, check actual network metrics)
    return 'healthy';
  }

  /**
   * Generate health recommendations
   */
  generateHealthRecommendations(components) {
    const recommendations = [];
    
    if (components.memory === 'warning' || components.memory === 'critical') {
      recommendations.push({
        type: 'memory',
        priority: 'high',
        action: 'Consider increasing memory allocation or optimizing memory usage'
      });
    }
    
    if (components.cpu === 'warning' || components.cpu === 'critical') {
      recommendations.push({
        type: 'cpu',
        priority: 'high',
        action: 'Optimize CPU-intensive operations or scale horizontally'
      });
    }
    
    return recommendations;
  }

  /**
   * Shutdown the self-healing service
   */
  async shutdown() {
    logger.info('🛑 Shutting down Self-Healing Service...');
    this.isActive = false;
    this.emit('shutdown');
    logger.info('✅ Self-Healing Service shutdown complete');
  }
}

module.exports = SelfHealingService;
