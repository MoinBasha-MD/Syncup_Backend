const AgentOrchestrator = require('./agentOrchestrator');
const SchedulingAgent = require('./agents/schedulingAgent');
const SecurityAgent = require('./agents/securityAgent');
const AnalyticsAgent = require('./agents/analyticsAgent');
const CommunicationAgent = require('./agents/communicationAgent');
const MaintenanceAgent = require('./agents/maintenanceAgent');
const SearchAgent = require('./agents/searchAgent');
const PersonalizationAgent = require('./agents/personalizationAgent');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/agent-integration.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class AgentIntegrationService {
  constructor() {
    this.orchestrator = null;
    this.agents = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize the complete agent system
   */
  async initialize() {
    try {
      logger.info('🚀 Initializing Agent Integration Service...');
      
      // Initialize orchestrator
      this.orchestrator = new AgentOrchestrator();
      await this.orchestrator.initialize();
      
      // Initialize and register all agents
      await this.initializeAgents();
      
      // Set up event listeners
      this.setupEventListeners();
      
      this.isInitialized = true;
      
      logger.info('✅ Agent Integration Service initialized successfully');
      
      return {
        success: true,
        message: 'Agent system initialized',
        agentCount: this.agents.size,
        orchestratorStatus: this.orchestrator.getStatus()
      };
      
    } catch (error) {
      logger.error('❌ Agent Integration Service initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize all specialized agents
   */
  async initializeAgents() {
    try {
      // Initialize Scheduling Agent
      const schedulingAgent = new SchedulingAgent();
      const schedulingAgentId = await this.orchestrator.registerAgent(
        'scheduling',
        schedulingAgent,
        ['schedule_status_update', 'schedule_recurring_task', 'optimize_schedules']
      );
      await schedulingAgent.initialize(schedulingAgentId);
      this.agents.set('scheduling', { instance: schedulingAgent, id: schedulingAgentId });
      
      // Initialize Security Agent
      const securityAgent = new SecurityAgent();
      const securityAgentId = await this.orchestrator.registerAgent(
        'security',
        securityAgent,
        ['analyze_request', 'detect_anomaly', 'scan_for_threats', 'validate_user_behavior']
      );
      await securityAgent.initialize(securityAgentId);
      this.agents.set('security', { instance: securityAgent, id: securityAgentId });
      
      // Initialize Analytics Agent
      const analyticsAgent = new AnalyticsAgent();
      const analyticsAgentId = await this.orchestrator.registerAgent(
        'analytics',
        analyticsAgent,
        ['generate_user_analytics', 'analyze_engagement_patterns', 'predict_user_behavior']
      );
      await analyticsAgent.initialize(analyticsAgentId);
      this.agents.set('analytics', { instance: analyticsAgent, id: analyticsAgentId });
      
      // Initialize Communication Agent
      const communicationAgent = new CommunicationAgent();
      const communicationAgentId = await this.orchestrator.registerAgent(
        'communication',
        communicationAgent,
        ['send_message', 'broadcast_message', 'send_notification', 'optimize_delivery']
      );
      await communicationAgent.initialize(communicationAgentId);
      this.agents.set('communication', { instance: communicationAgent, id: communicationAgentId });
      
      // Initialize Maintenance Agent
      const maintenanceAgent = new MaintenanceAgent();
      const maintenanceAgentId = await this.orchestrator.registerAgent(
        'maintenance',
        maintenanceAgent,
        ['cleanup_logs', 'optimize_database', 'monitor_resources', 'fix_system_issues']
      );
      await maintenanceAgent.initialize(maintenanceAgentId);
      this.agents.set('maintenance', { instance: maintenanceAgent, id: maintenanceAgentId });
      
      // Initialize Search Agent
      const searchAgent = new SearchAgent();
      const searchAgentId = await this.orchestrator.registerAgent(
        'search',
        searchAgent,
        ['search_users', 'search_messages', 'global_search', 'get_search_suggestions']
      );
      await searchAgent.initialize(searchAgentId);
      this.agents.set('search', { instance: searchAgent, id: searchAgentId });
      
      // Initialize Personalization Agent
      const personalizationAgent = new PersonalizationAgent();
      const personalizationAgentId = await this.orchestrator.registerAgent(
        'personalization',
        personalizationAgent,
        ['generate_user_profile', 'get_recommendations', 'learn_from_interaction', 'customize_content']
      );
      await personalizationAgent.initialize(personalizationAgentId);
      this.agents.set('personalization', { instance: personalizationAgent, id: personalizationAgentId });
      
      logger.info(`✅ Initialized ${this.agents.size} specialized agents`);
      
    } catch (error) {
      logger.error('❌ Agent initialization failed:', error);
      throw error;
    }
  }

  /**
   * Set up event listeners for agent coordination
   */
  setupEventListeners() {
    // Orchestrator events
    this.orchestrator.on('taskCompleted', (data) => {
      logger.info(`✅ Task completed: ${data.task.taskId}`);
      this.handleTaskCompletion(data);
    });
    
    this.orchestrator.on('taskFailed', (data) => {
      logger.warn(`❌ Task failed: ${data.task.taskId} - ${data.error.message}`);
      this.handleTaskFailure(data);
    });
    
    this.orchestrator.on('agentRegistered', (data) => {
      logger.info(`🤖 Agent registered: ${data.agentId} (${data.agentType})`);
    });
    
    // Cross-agent communication events
    this.setupCrossAgentCommunication();
  }

  /**
   * Set up cross-agent communication
   */
  setupCrossAgentCommunication() {
    // Cross-agent communication will be handled through the orchestrator
    // Agents can communicate by submitting tasks to each other
    
    logger.info('🔗 Cross-agent communication channels established');
    
    // Example: Security threats trigger analytics tasks
    this.orchestrator.on('taskCompleted', async (data) => {
      const { task, result } = data;
      
      // If security agent detects threats, notify analytics
      if (task.agentType === 'security' && task.taskType === 'analyze_request') {
        if (result.analysis?.threats?.length > 0) {
          await this.orchestrator.submitTask('analytics', 'analyze', {
            action: 'analyze_security_threat',
            data: result.analysis
          }, { priority: 'high' });
        }
      }
      
      // If analytics finds optimal times, notify scheduler
      if (task.agentType === 'analytics' && task.taskType === 'analyze') {
        if (result.insights?.optimalTimes) {
          await this.orchestrator.submitTask('scheduling', 'optimize', {
            action: 'optimize_schedules',
            data: result.insights.optimalTimes
          }, { priority: 'medium' });
        }
      }
    });
  }

  /**
   * Submit a task to the agent system
   */
  async submitTask(agentType, taskType, payload, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Agent system not initialized');
    }
    
    return await this.orchestrator.submitTask(agentType, taskType, payload, options);
  }

  /**
   * Get system status
   */
  getSystemStatus() {
    if (!this.isInitialized) {
      return { initialized: false, message: 'Agent system not initialized' };
    }
    
    return {
      initialized: true,
      orchestrator: this.orchestrator.getStatus(),
      agents: Array.from(this.agents.entries()).map(([type, agent]) => ({
        type,
        id: agent.id,
        status: 'active' // Could be enhanced to get actual status
      }))
    };
  }

  /**
   * Handle task completion
   */
  async handleTaskCompletion(data) {
    const { task, result } = data;
    
    // Trigger follow-up actions based on task type
    switch (task.agentType) {
      case 'security':
        if (task.taskType === 'analyze_request' && result.analysis?.blocked) {
          // Log security incident
          await this.submitTask('analytics', 'process', {
            action: 'log_security_incident',
            data: { task, result }
          }, { priority: 'high' });
        }
        break;
        
      case 'analytics':
        if (task.taskType === 'analyze' && result.insights) {
          // Share insights with other agents
          await this.broadcastInsights(result.insights);
        }
        break;
        
      case 'communication':
        if (task.taskType === 'send_message' && result.success) {
          // Update analytics with communication metrics
          await this.submitTask('analytics', 'process', {
            action: 'update_communication_metrics',
            data: { messageId: result.messageId, deliveryTime: result.deliveryTime }
          }, { priority: 'low' });
        }
        break;
    }
  }

  /**
   * Handle task failure
   */
  async handleTaskFailure(data) {
    const { task, error } = data;
    
    // Log failure for analytics
    await this.submitTask('analytics', 'process', {
      action: 'log_task_failure',
      data: { taskId: task.taskId, agentType: task.agentType, error: error.message }
    }, { priority: 'low' });
    
    // If it's a critical security task, escalate
    if (task.agentType === 'security' && task.priority === 'critical') {
      logger.error(`🚨 Critical security task failed: ${task.taskId}`);
      // Could trigger alerts, notifications, etc.
    }
  }

  /**
   * Broadcast insights to relevant agents
   */
  async broadcastInsights(insights) {
    // This could be enhanced to intelligently route insights
    // to agents that can act on them
    logger.info('📊 Broadcasting insights to agents:', insights);
  }

  /**
   * Shutdown the agent system
   */
  async shutdown() {
    try {
      logger.info('🛑 Shutting down Agent Integration Service...');
      
      // Shutdown all agents
      for (const [type, agent] of this.agents) {
        try {
          if (agent.instance.shutdown) {
            await agent.instance.shutdown();
          }
        } catch (error) {
          logger.error(`❌ Error shutting down ${type} agent:`, error);
        }
      }
      
      // Shutdown orchestrator
      if (this.orchestrator) {
        await this.orchestrator.shutdown();
      }
      
      this.isInitialized = false;
      this.agents.clear();
      
      logger.info('✅ Agent Integration Service shutdown complete');
      
    } catch (error) {
      logger.error('❌ Agent Integration Service shutdown failed:', error);
      throw error;
    }
  }

  /**
   * Get agent by type
   */
  getAgent(agentType) {
    return this.agents.get(agentType);
  }

  /**
   * Get orchestrator instance
   */
  getOrchestrator() {
    return this.orchestrator;
  }

  /**
   * Health check for the entire system
   */
  async healthCheck() {
    if (!this.isInitialized) {
      return { status: 'unhealthy', reason: 'Not initialized' };
    }
    
    try {
      const orchestratorHealth = this.orchestrator.getStatus();
      const agentHealths = {};
      
      for (const [type, agent] of this.agents) {
        try {
          agentHealths[type] = await agent.instance.healthCheck();
        } catch (error) {
          agentHealths[type] = { status: 'unhealthy', error: error.message };
        }
      }
      
      const allHealthy = Object.values(agentHealths).every(health => 
        health.status === 'healthy' || health.status === 'active'
      );
      
      return {
        status: allHealthy ? 'healthy' : 'degraded',
        orchestrator: orchestratorHealth,
        agents: agentHealths,
        timestamp: new Date()
      };
      
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date()
      };
    }
  }
}

// Export singleton instance
const agentIntegrationService = new AgentIntegrationService();
module.exports = agentIntegrationService;
