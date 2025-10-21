const EventEmitter = require('events');
const winston = require('winston');
const os = require('os');

// Configure logger for Dynamic Scaling Service
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/dynamic-scaling.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class DynamicScalingService extends EventEmitter {
  constructor() {
    super();
    this.isActive = false;
    this.agentInstances = new Map();
    this.scalingHistory = [];
    this.resourceMetrics = new Map();
    
    this.metrics = {
      totalScalingEvents: 0,
      scaleUpEvents: 0,
      scaleDownEvents: 0,
      averageResponseTime: 0,
      resourceEfficiency: 100,
      costOptimization: 0
    };
    
    this.scalingConfig = {
      minAgents: 1,           // Minimum agents per type
      maxAgents: 10,          // Maximum agents per type
      scaleUpThreshold: 0.8,  // 80% resource usage
      scaleDownThreshold: 0.3, // 30% resource usage
      cooldownPeriod: 60000,  // 1 minute between scaling events
      evaluationWindow: 30000, // 30 seconds evaluation window
      bandwidthThreshold: 1000000, // 1MB/s bandwidth threshold
      responseTimeThreshold: 2000   // 2 seconds response time threshold
    };
    
    this.lastScalingEvent = new Map();
    this.resourceHistory = new Map();
  }

  /**
   * Initialize the dynamic scaling service
   */
  async initialize(agentOrchestrator) {
    try {
      logger.info('⚡ Initializing Dynamic Scaling Service...');
      
      this.orchestrator = agentOrchestrator;
      this.isActive = true;
      
      // Start monitoring and scaling
      this.startResourceMonitoring();
      this.startScalingEvaluation();
      this.startBandwidthMonitoring();
      
      logger.info('✅ Dynamic Scaling Service initialized successfully');
      this.emit('initialized');
      
    } catch (error) {
      logger.error('❌ Dynamic Scaling Service initialization failed:', error);
      throw error;
    }
  }

  /**
   * Start continuous resource monitoring
   */
  startResourceMonitoring() {
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        const metrics = await this.collectResourceMetrics();
        const timestamp = Date.now();
        
        this.resourceMetrics.set(timestamp, metrics);
        
        // Keep only last 10 minutes of metrics
        const tenMinutesAgo = timestamp - (10 * 60 * 1000);
        for (const [time] of this.resourceMetrics) {
          if (time < tenMinutesAgo) {
            this.resourceMetrics.delete(time);
          }
        }
        
        // Store per-agent resource history
        for (const [agentType, agentMetrics] of Object.entries(metrics.agents)) {
          if (!this.resourceHistory.has(agentType)) {
            this.resourceHistory.set(agentType, []);
          }
          
          const history = this.resourceHistory.get(agentType);
          history.push({
            timestamp,
            ...agentMetrics
          });
          
          // Keep only last 20 data points per agent
          if (history.length > 20) {
            history.shift();
          }
        }
        
      } catch (error) {
        logger.error('❌ Resource monitoring error:', error);
      }
    }, 15000); // Every 15 seconds
  }

  /**
   * Start scaling evaluation
   */
  startScalingEvaluation() {
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        await this.evaluateScalingNeeds();
      } catch (error) {
        logger.error('❌ Scaling evaluation error:', error);
      }
    }, this.scalingConfig.evaluationWindow);
  }

  /**
   * Start bandwidth monitoring
   */
  startBandwidthMonitoring() {
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        const bandwidthMetrics = await this.collectBandwidthMetrics();
        await this.evaluateBandwidthScaling(bandwidthMetrics);
      } catch (error) {
        logger.error('❌ Bandwidth monitoring error:', error);
      }
    }, 10000); // Every 10 seconds
  }

  /**
   * Collect comprehensive resource metrics
   */
  async collectResourceMetrics() {
    const systemMetrics = {
      timestamp: new Date(),
      system: {
        cpuUsage: os.loadavg()[0] / os.cpus().length,
        memoryUsage: (os.totalmem() - os.freemem()) / os.totalmem(),
        uptime: os.uptime(),
        freeMemory: os.freemem(),
        totalMemory: os.totalmem()
      },
      process: {
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        uptime: process.uptime()
      },
      agents: {}
    };
    
    // Collect metrics for each agent type
    if (this.orchestrator) {
      const agentTypes = ['security', 'analytics', 'scheduling', 'communication', 'maintenance', 'search', 'personalization'];
      
      for (const agentType of agentTypes) {
        const agentCount = this.getAgentCount(agentType);
        const agentLoad = await this.calculateAgentLoad(agentType);
        const responseTime = await this.getAverageResponseTime(agentType);
        
        systemMetrics.agents[agentType] = {
          count: agentCount,
          load: agentLoad,
          responseTime: responseTime,
          efficiency: this.calculateEfficiency(agentLoad, responseTime),
          queueSize: await this.getQueueSize(agentType)
        };
      }
    }
    
    return systemMetrics;
  }

  /**
   * Collect bandwidth metrics
   */
  async collectBandwidthMetrics() {
    // In a real implementation, this would collect actual network metrics
    // For now, we'll simulate bandwidth usage
    return {
      timestamp: new Date(),
      inbound: Math.random() * 2000000,  // Simulated bytes/sec
      outbound: Math.random() * 1500000, // Simulated bytes/sec
      connections: Math.floor(Math.random() * 100) + 50,
      latency: Math.random() * 100 + 10  // Simulated ms
    };
  }

  /**
   * Evaluate scaling needs for all agents
   */
  async evaluateScalingNeeds() {
    if (!this.orchestrator) return;
    
    const agentTypes = ['security', 'analytics', 'scheduling', 'communication', 'maintenance', 'search', 'personalization'];
    
    for (const agentType of agentTypes) {
      await this.evaluateAgentScaling(agentType);
    }
  }

  /**
   * Evaluate scaling needs for specific agent type
   */
  async evaluateAgentScaling(agentType) {
    try {
      const currentCount = this.getAgentCount(agentType);
      const agentLoad = await this.calculateAgentLoad(agentType);
      const responseTime = await this.getAverageResponseTime(agentType);
      const queueSize = await this.getQueueSize(agentType);
      
      // Check if we're in cooldown period
      const lastScaling = this.lastScalingEvent.get(agentType);
      if (lastScaling && (Date.now() - lastScaling) < this.scalingConfig.cooldownPeriod) {
        return;
      }
      
      let scalingDecision = null;
      
      // Determine if we need to scale up
      if (this.shouldScaleUp(agentLoad, responseTime, queueSize, currentCount)) {
        scalingDecision = {
          action: 'scale_up',
          reason: `High load: ${Math.round(agentLoad * 100)}%, Response time: ${responseTime}ms, Queue: ${queueSize}`,
          targetCount: Math.min(currentCount + 1, this.scalingConfig.maxAgents)
        };
      }
      // Determine if we need to scale down
      else if (this.shouldScaleDown(agentLoad, responseTime, queueSize, currentCount)) {
        scalingDecision = {
          action: 'scale_down',
          reason: `Low load: ${Math.round(agentLoad * 100)}%, Response time: ${responseTime}ms, Queue: ${queueSize}`,
          targetCount: Math.max(currentCount - 1, this.scalingConfig.minAgents)
        };
      }
      
      if (scalingDecision) {
        await this.executeScaling(agentType, scalingDecision);
      }
      
    } catch (error) {
      logger.error(`❌ Agent scaling evaluation failed for ${agentType}:`, error);
    }
  }

  /**
   * Evaluate bandwidth-based scaling
   */
  async evaluateBandwidthScaling(bandwidthMetrics) {
    const totalBandwidth = bandwidthMetrics.inbound + bandwidthMetrics.outbound;
    
    if (totalBandwidth > this.scalingConfig.bandwidthThreshold) {
      logger.info(`📊 High bandwidth usage detected: ${Math.round(totalBandwidth / 1000000)}MB/s`);
      
      // Scale up communication and analytics agents for high bandwidth
      await this.evaluateAgentScaling('communication');
      await this.evaluateAgentScaling('analytics');
    }
    
    if (bandwidthMetrics.latency > 100) {
      logger.warn(`🐌 High latency detected: ${bandwidthMetrics.latency}ms`);
      
      // Scale up relevant agents to handle latency
      await this.evaluateAgentScaling('communication');
    }
  }

  /**
   * Check if agent should scale up
   */
  shouldScaleUp(load, responseTime, queueSize, currentCount) {
    return (
      currentCount < this.scalingConfig.maxAgents &&
      (
        load > this.scalingConfig.scaleUpThreshold ||
        responseTime > this.scalingConfig.responseTimeThreshold ||
        queueSize > 10
      )
    );
  }

  /**
   * Check if agent should scale down
   */
  shouldScaleDown(load, responseTime, queueSize, currentCount) {
    return (
      currentCount > this.scalingConfig.minAgents &&
      load < this.scalingConfig.scaleDownThreshold &&
      responseTime < 1000 &&
      queueSize < 3
    );
  }

  /**
   * Execute scaling action
   */
  async executeScaling(agentType, decision) {
    try {
      logger.info(`⚡ Scaling ${decision.action} for ${agentType}: ${decision.reason}`);
      
      const scalingEvent = {
        id: `scaling_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        agentType,
        action: decision.action,
        reason: decision.reason,
        fromCount: this.getAgentCount(agentType),
        toCount: decision.targetCount,
        timestamp: new Date(),
        status: 'in_progress'
      };
      
      // Record scaling event
      this.scalingHistory.push(scalingEvent);
      this.lastScalingEvent.set(agentType, Date.now());
      
      // Execute the scaling (simulate for now)
      const success = await this.performScaling(agentType, decision);
      
      scalingEvent.status = success ? 'completed' : 'failed';
      scalingEvent.completedAt = new Date();
      
      // Update metrics
      this.metrics.totalScalingEvents++;
      if (decision.action === 'scale_up') {
        this.metrics.scaleUpEvents++;
      } else {
        this.metrics.scaleDownEvents++;
      }
      
      // Keep only last 50 scaling events
      if (this.scalingHistory.length > 50) {
        this.scalingHistory.shift();
      }
      
      this.emit('scalingCompleted', scalingEvent);
      
      logger.info(`✅ Scaling completed for ${agentType}: ${scalingEvent.fromCount} → ${scalingEvent.toCount}`);
      
    } catch (error) {
      logger.error(`❌ Scaling execution failed for ${agentType}:`, error);
    }
  }

  /**
   * Perform actual scaling operation
   */
  async performScaling(agentType, decision) {
    try {
      // In a real implementation, this would:
      // - Spawn new agent instances for scale up
      // - Gracefully shutdown agents for scale down
      // - Update load balancer configuration
      // - Redistribute tasks among agents
      
      // For now, we'll simulate the scaling
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update our internal count tracking
      if (!this.agentInstances.has(agentType)) {
        this.agentInstances.set(agentType, this.scalingConfig.minAgents);
      }
      
      this.agentInstances.set(agentType, decision.targetCount);
      
      return true;
    } catch (error) {
      logger.error(`❌ Scaling operation failed:`, error);
      return false;
    }
  }

  /**
   * Get current agent count for type
   */
  getAgentCount(agentType) {
    return this.agentInstances.get(agentType) || 1;
  }

  /**
   * Calculate agent load (simulated)
   */
  async calculateAgentLoad(agentType) {
    // In real implementation, this would calculate actual load
    // For now, simulate load based on agent type
    const baseLoad = {
      security: 0.4,
      analytics: 0.6,
      scheduling: 0.3,
      communication: 0.7,
      maintenance: 0.2,
      search: 0.5,
      personalization: 0.6
    };
    
    return (baseLoad[agentType] || 0.5) + (Math.random() * 0.3 - 0.15);
  }

  /**
   * Get average response time for agent type
   */
  async getAverageResponseTime(agentType) {
    // Simulate response times
    const baseTimes = {
      security: 150,
      analytics: 300,
      scheduling: 100,
      communication: 200,
      maintenance: 500,
      search: 250,
      personalization: 400
    };
    
    return (baseTimes[agentType] || 200) + (Math.random() * 100 - 50);
  }

  /**
   * Get queue size for agent type
   */
  async getQueueSize(agentType) {
    // Simulate queue sizes
    return Math.floor(Math.random() * 15);
  }

  /**
   * Calculate efficiency score
   */
  calculateEfficiency(load, responseTime) {
    const loadScore = Math.max(0, 100 - (load * 100));
    const timeScore = Math.max(0, 100 - (responseTime / 20));
    return Math.round((loadScore + timeScore) / 2);
  }

  /**
   * Get scaling status
   */
  getScalingStatus() {
    return {
      isActive: this.isActive,
      metrics: this.metrics,
      agentCounts: Object.fromEntries(this.agentInstances),
      recentScalingEvents: this.scalingHistory.slice(-10),
      scalingConfig: this.scalingConfig,
      resourceEfficiency: this.calculateOverallEfficiency()
    };
  }

  /**
   * Calculate overall system efficiency
   */
  calculateOverallEfficiency() {
    const recentMetrics = Array.from(this.resourceMetrics.values()).slice(-5);
    if (recentMetrics.length === 0) return 100;
    
    const avgEfficiency = recentMetrics.reduce((sum, metrics) => {
      const agentEfficiencies = Object.values(metrics.agents || {})
        .map(agent => agent.efficiency || 100);
      const avgAgentEfficiency = agentEfficiencies.length > 0 
        ? agentEfficiencies.reduce((a, b) => a + b) / agentEfficiencies.length 
        : 100;
      return sum + avgAgentEfficiency;
    }, 0) / recentMetrics.length;
    
    return Math.round(avgEfficiency);
  }

  /**
   * Update scaling configuration
   */
  updateScalingConfig(newConfig) {
    this.scalingConfig = { ...this.scalingConfig, ...newConfig };
    logger.info('⚙️ Scaling configuration updated:', newConfig);
    this.emit('configUpdated', this.scalingConfig);
  }

  /**
   * Shutdown the dynamic scaling service
   */
  async shutdown() {
    logger.info('🛑 Shutting down Dynamic Scaling Service...');
    this.isActive = false;
    this.emit('shutdown');
    logger.info('✅ Dynamic Scaling Service shutdown complete');
  }
}

module.exports = DynamicScalingService;
