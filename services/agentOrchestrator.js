const EventEmitter = require('events');
const AgentTask = require('../models/agentTaskModel');
const AgentState = require('../models/agentStateModel');
const winston = require('winston');

// Configure logger for Agent Orchestrator
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/agent-orchestrator.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class AgentOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.agents = new Map(); // agentId -> agent instance
    this.taskQueues = new Map(); // agentType -> task queue
    this.isRunning = false;
    this.processingInterval = null;
    this.healthCheckInterval = null;
    this.metricsInterval = null;
    
    // Performance metrics
    this.metrics = {
      tasksProcessed: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      averageProcessingTime: 0,
      systemLoad: 0,
      startTime: Date.now()
    };
    
    // Configuration
    this.config = {
      processingIntervalMs: 1000, // 1 second
      healthCheckIntervalMs: 30000, // 30 seconds
      metricsIntervalMs: 60000, // 1 minute
      maxConcurrentTasks: 100,
      taskTimeoutMs: 300000 // 5 minutes
    };
  }

  /**
   * Initialize the orchestrator
   */
  async initialize() {
    try {
      logger.info('🚀 Initializing Agent Orchestrator...');
      
      // Initialize task queues for each agent type
      const agentTypes = ['scheduling', 'communication', 'search', 'analytics', 'security', 'maintenance', 'personalization'];
      agentTypes.forEach(type => {
        this.taskQueues.set(type, []);
      });
      
      // Load existing agent states
      await this.loadAgentStates();
      
      // Start processing
      this.start();
      
      logger.info('✅ Agent Orchestrator initialized successfully');
      this.emit('initialized');
      
    } catch (error) {
      logger.error('❌ Failed to initialize Agent Orchestrator:', error);
      throw error;
    }
  }

  /**
   * Register a new agent
   */
  async registerAgent(agentType, agentInstance, capabilities = []) {
    try {
      const agentId = `${agentType}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      
      // Store agent instance
      this.agents.set(agentId, agentInstance);
      
      // Create or update agent state
      const agentState = await AgentState.findOneAndUpdate(
        { agentId },
        {
          agentId,
          agentType,
          status: 'active',
          capabilities,
          metadata: {
            version: '1.0.0',
            startTime: new Date(),
            processId: process.pid,
            nodeId: require('os').hostname(),
            environment: process.env.NODE_ENV || 'development'
          }
        },
        { upsert: true, new: true }
      );
      
      logger.info(`✅ Agent registered: ${agentId} (${agentType})`);
      this.emit('agentRegistered', { agentId, agentType, capabilities });
      
      return agentId;
      
    } catch (error) {
      logger.error('❌ Failed to register agent:', error);
      throw error;
    }
  }

  /**
   * Submit a task to the orchestrator
   */
  async submitTask(agentType, taskType, payload, options = {}) {
    try {
      const task = new AgentTask({
        agentType,
        taskType,
        payload,
        priority: options.priority || 'medium',
        context: options.context || {},
        scheduledFor: options.scheduledFor || new Date(),
        expiresAt: options.expiresAt
      });
      
      await task.save();
      
      // Add to appropriate queue
      const queue = this.taskQueues.get(agentType) || [];
      queue.push(task);
      this.taskQueues.set(agentType, queue);
      
      logger.info(`📋 Task submitted: ${task.taskId} (${agentType}/${taskType})`);
      this.emit('taskSubmitted', task);
      
      return task.taskId;
      
    } catch (error) {
      logger.error('❌ Failed to submit task:', error);
      throw error;
    }
  }

  /**
   * Start the orchestrator processing
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    // Start task processing
    this.processingInterval = setInterval(() => {
      this.processTasks();
    }, this.config.processingIntervalMs);
    
    // Start health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckIntervalMs);
    
    // Start metrics collection
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.metricsIntervalMs);
    
    logger.info('🚀 Agent Orchestrator started');
    this.emit('started');
  }

  /**
   * Stop the orchestrator
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    logger.info('🛑 Agent Orchestrator stopped');
    this.emit('stopped');
  }

  /**
   * Process pending tasks
   */
  async processTasks() {
    try {
      for (const [agentType, queue] of this.taskQueues) {
        if (queue.length === 0) continue;
        
        // Find available agents for this type
        const availableAgents = await AgentState.findActiveAgents(agentType);
        if (availableAgents.length === 0) continue;
        
        // Process tasks up to agent capacity
        const tasksToProcess = queue.splice(0, Math.min(queue.length, availableAgents.length * 5));
        
        for (const task of tasksToProcess) {
          await this.assignTaskToAgent(task, availableAgents);
        }
      }
    } catch (error) {
      logger.error('❌ Error processing tasks:', error);
    }
  }

  /**
   * Assign task to best available agent
   */
  async assignTaskToAgent(task, availableAgents) {
    try {
      // Find best agent based on performance and load
      const bestAgent = await AgentState.findBestAgent(task.agentType);
      if (!bestAgent) {
        logger.warn(`⚠️ No available agent for task ${task.taskId}`);
        return;
      }
      
      // Update task with agent assignment
      task.agentId = bestAgent.agentId;
      await task.markStarted();
      
      // Get agent instance
      const agentInstance = this.agents.get(bestAgent.agentId);
      if (!agentInstance) {
        await task.markFailed('Agent instance not found');
        return;
      }
      
      // Update agent state
      await bestAgent.incrementTaskCount();
      
      // Execute task
      this.executeTask(task, agentInstance, bestAgent);
      
    } catch (error) {
      logger.error(`❌ Failed to assign task ${task.taskId}:`, error);
      await task.markFailed(error.message);
    }
  }

  /**
   * Execute task with agent
   */
  async executeTask(task, agentInstance, agentState) {
    const startTime = Date.now();
    
    try {
      logger.info(`🔄 Executing task ${task.taskId} with agent ${agentState.agentId}`);
      
      // Execute task based on type
      let result;
      switch (task.taskType) {
        case 'process':
          result = await agentInstance.processTask(task.payload, task.context);
          break;
        case 'analyze':
          result = await agentInstance.analyzeData(task.payload, task.context);
          break;
        case 'monitor':
          result = await agentInstance.monitorSystem(task.payload, task.context);
          break;
        case 'optimize':
          result = await agentInstance.optimizePerformance(task.payload, task.context);
          break;
        case 'alert':
          result = await agentInstance.sendAlert(task.payload, task.context);
          break;
        case 'schedule':
          result = await agentInstance.scheduleTask(task.payload, task.context);
          break;
        case 'communicate':
          result = await agentInstance.communicate(task.payload, task.context);
          break;
        default:
          throw new Error(`Unknown task type: ${task.taskType}`);
      }
      
      const processingTime = Date.now() - startTime;
      
      // Mark task as completed
      await task.markCompleted({
        data: result,
        metrics: {
          processingTime,
          memoryUsed: process.memoryUsage().heapUsed,
          cpuUsed: process.cpuUsage().user
        }
      });
      
      // Update agent performance
      await agentState.recordTaskCompletion(processingTime, true);
      
      // Update orchestrator metrics
      this.metrics.tasksCompleted++;
      this.updateAverageProcessingTime(processingTime);
      
      logger.info(`✅ Task ${task.taskId} completed in ${processingTime}ms`);
      this.emit('taskCompleted', { task, result, processingTime });
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      logger.error(`❌ Task ${task.taskId} failed:`, error);
      
      // Mark task as failed
      await task.markFailed(error.message);
      
      // Update agent performance
      await agentState.recordTaskCompletion(processingTime, false);
      
      // Update orchestrator metrics
      this.metrics.tasksFailed++;
      
      this.emit('taskFailed', { task, error, processingTime });
    }
  }

  /**
   * Perform health checks on all agents
   */
  async performHealthChecks() {
    try {
      const agents = await AgentState.find({});
      
      for (const agent of agents) {
        const agentInstance = this.agents.get(agent.agentId);
        
        if (!agentInstance) {
          await agent.updateHealth({ status: 'critical', lastError: 'Agent instance not found' });
          continue;
        }
        
        try {
          const healthData = await agentInstance.healthCheck();
          await agent.updateHealth({
            status: 'healthy',
            uptime: Date.now() - agent.metadata.startTime
          });
        } catch (error) {
          await agent.updateHealth({
            status: 'warning',
            lastError: error.message
          });
        }
      }
      
    } catch (error) {
      logger.error('❌ Health check failed:', error);
    }
  }

  /**
   * Collect system metrics
   */
  async collectMetrics() {
    try {
      const systemHealth = await AgentState.getSystemHealth();
      const taskStats = await AgentTask.getTaskStats();
      
      this.metrics.systemLoad = process.cpuUsage().user / 1000000; // Convert to seconds
      
      logger.info('📊 System metrics collected', {
        orchestratorMetrics: this.metrics,
        systemHealth,
        taskStats
      });
      
      this.emit('metricsCollected', {
        orchestrator: this.metrics,
        system: systemHealth,
        tasks: taskStats
      });
      
    } catch (error) {
      logger.error('❌ Metrics collection failed:', error);
    }
  }

  /**
   * Load existing agent states from database
   */
  async loadAgentStates() {
    try {
      const agents = await AgentState.find({ status: { $ne: 'shutdown' } });
      logger.info(`📋 Loaded ${agents.length} existing agent states`);
    } catch (error) {
      logger.error('❌ Failed to load agent states:', error);
    }
  }

  /**
   * Update average processing time
   */
  updateAverageProcessingTime(newTime) {
    const totalTasks = this.metrics.tasksCompleted + this.metrics.tasksFailed;
    this.metrics.averageProcessingTime = 
      ((this.metrics.averageProcessingTime * (totalTasks - 1)) + newTime) / totalTasks;
  }

  /**
   * Get orchestrator status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      metrics: this.metrics,
      agentCount: this.agents.size,
      queueSizes: Object.fromEntries(
        Array.from(this.taskQueues.entries()).map(([type, queue]) => [type, queue.length])
      ),
      uptime: Date.now() - this.metrics.startTime
    };
  }

  /**
   * Shutdown orchestrator gracefully
   */
  async shutdown() {
    logger.info('🛑 Shutting down Agent Orchestrator...');
    
    this.stop();
    
    // Update all agent states to shutdown
    await AgentState.updateMany(
      { status: { $ne: 'shutdown' } },
      { status: 'shutdown' }
    );
    
    this.emit('shutdown');
    logger.info('✅ Agent Orchestrator shutdown complete');
  }
}

module.exports = AgentOrchestrator;
