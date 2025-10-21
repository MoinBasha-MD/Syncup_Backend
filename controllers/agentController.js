const asyncHandler = require('express-async-handler');
const AgentOrchestrator = require('../services/agentOrchestrator');
const AgentTask = require('../models/agentTaskModel');
const AgentState = require('../models/agentStateModel');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/agent-controller.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

// Global orchestrator instance
let orchestrator = null;

/**
 * Initialize the agent system
 */
const initializeAgentSystem = asyncHandler(async (req, res) => {
  try {
    if (orchestrator && orchestrator.isRunning) {
      return res.status(400).json({
        success: false,
        message: 'Agent system is already running'
      });
    }
    
    orchestrator = new AgentOrchestrator();
    await orchestrator.initialize();
    
    // Store orchestrator in app for global access
    req.app.set('agentOrchestrator', orchestrator);
    
    logger.info('🚀 Agent system initialized via API');
    
    res.status(200).json({
      success: true,
      message: 'Agent system initialized successfully',
      data: {
        status: orchestrator.getStatus(),
        timestamp: new Date()
      }
    });
    
  } catch (error) {
    logger.error('❌ Agent system initialization failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize agent system',
      error: error.message
    });
  }
});

/**
 * Submit a task to the agent system
 */
const submitTask = asyncHandler(async (req, res) => {
  try {
    const { agentType, taskType, payload, priority = 'medium', scheduledFor, expiresAt } = req.body;
    
    // Validate required fields
    if (!agentType || !taskType || !payload) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: agentType, taskType, payload'
      });
    }
    
    // Get orchestrator instance
    const orchestrator = req.app.get('agentOrchestrator');
    if (!orchestrator || !orchestrator.isRunning) {
      return res.status(503).json({
        success: false,
        message: 'Agent system is not running'
      });
    }
    
    // Submit task
    const taskId = await orchestrator.submitTask(agentType, taskType, payload, {
      priority,
      context: {
        userId: req.user?.userId,
        sessionId: req.sessionID,
        requestId: req.headers['x-request-id'],
        source: 'api'
      },
      scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined
    });
    
    logger.info(`📋 Task submitted via API: ${taskId} (${agentType}/${taskType})`);
    
    res.status(201).json({
      success: true,
      message: 'Task submitted successfully',
      data: {
        taskId,
        agentType,
        taskType,
        priority,
        status: 'pending',
        submittedAt: new Date()
      }
    });
    
  } catch (error) {
    logger.error('❌ Task submission failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit task',
      error: error.message
    });
  }
});

/**
 * Get task status
 */
const getTaskStatus = asyncHandler(async (req, res) => {
  try {
    const { taskId } = req.params;
    
    const task = await AgentTask.findOne({ taskId });
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        taskId: task.taskId,
        agentType: task.agentType,
        agentId: task.agentId,
        taskType: task.taskType,
        status: task.status,
        priority: task.priority,
        createdAt: task.createdAt,
        execution: task.execution,
        result: task.result,
        progress: calculateTaskProgress(task)
      }
    });
    
  } catch (error) {
    logger.error('❌ Get task status failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get task status',
      error: error.message
    });
  }
});

/**
 * Get all tasks for a user
 */
const getUserTasks = asyncHandler(async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, agentType, limit = 50, page = 1 } = req.query;
    
    // Build query
    const query = { 'context.userId': userId };
    if (status) query.status = status;
    if (agentType) query.agentType = agentType;
    
    // Execute query with pagination
    const skip = (page - 1) * limit;
    const [tasks, total] = await Promise.all([
      AgentTask.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      AgentTask.countDocuments(query)
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        tasks: tasks.map(task => ({
          taskId: task.taskId,
          agentType: task.agentType,
          taskType: task.taskType,
          status: task.status,
          priority: task.priority,
          createdAt: task.createdAt,
          execution: task.execution,
          progress: calculateTaskProgress(task)
        })),
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      }
    });
    
  } catch (error) {
    logger.error('❌ Get user tasks failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user tasks',
      error: error.message
    });
  }
});

/**
 * Cancel a task
 */
const cancelTask = asyncHandler(async (req, res) => {
  try {
    const { taskId } = req.params;
    
    const task = await AgentTask.findOne({ taskId });
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }
    
    // Check if task can be cancelled
    if (task.status === 'completed' || task.status === 'failed') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel task with status: ${task.status}`
      });
    }
    
    // Update task status
    task.status = 'cancelled';
    await task.save();
    
    logger.info(`🚫 Task cancelled: ${taskId}`);
    
    res.status(200).json({
      success: true,
      message: 'Task cancelled successfully',
      data: {
        taskId,
        status: 'cancelled',
        cancelledAt: new Date()
      }
    });
    
  } catch (error) {
    logger.error('❌ Task cancellation failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel task',
      error: error.message
    });
  }
});

/**
 * Get agent system status
 */
const getSystemStatus = asyncHandler(async (req, res) => {
  try {
    const orchestrator = req.app.get('agentOrchestrator');
    
    if (!orchestrator) {
      return res.status(503).json({
        success: false,
        message: 'Agent system not initialized'
      });
    }
    
    // Get orchestrator status
    const orchestratorStatus = orchestrator.getStatus();
    
    // Get agent states
    const agentStates = await AgentState.find({}).lean();
    
    // Get system health
    const systemHealth = await AgentState.getSystemHealth();
    
    // Get recent task statistics
    const taskStats = await getRecentTaskStats();
    
    res.status(200).json({
      success: true,
      data: {
        orchestrator: orchestratorStatus,
        agents: {
          total: agentStates.length,
          active: agentStates.filter(a => a.status === 'active').length,
          healthy: agentStates.filter(a => a.health.status === 'healthy').length,
          states: agentStates.map(agent => ({
            agentId: agent.agentId,
            agentType: agent.agentType,
            status: agent.status,
            health: agent.health.status,
            performance: agent.performance,
            lastActivity: agent.metadata.lastActivity
          }))
        },
        systemHealth,
        tasks: taskStats,
        timestamp: new Date()
      }
    });
    
  } catch (error) {
    logger.error('❌ Get system status failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system status',
      error: error.message
    });
  }
});

/**
 * Get agent performance metrics
 */
const getAgentMetrics = asyncHandler(async (req, res) => {
  try {
    const { agentType, timeRange = '24h' } = req.query;
    
    // Calculate time range
    const endDate = new Date();
    const startDate = new Date();
    const hours = parseInt(timeRange) || 24;
    startDate.setHours(endDate.getHours() - hours);
    
    // Build query
    const query = { createdAt: { $gte: startDate, $lte: endDate } };
    if (agentType) query.agentType = agentType;
    
    // Get task statistics
    const taskStats = await AgentTask.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$agentType',
          totalTasks: { $sum: 1 },
          completedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          failedTasks: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          averageProcessingTime: { $avg: '$execution.duration' },
          totalProcessingTime: { $sum: '$execution.duration' }
        }
      }
    ]);
    
    // Get agent performance data
    const agentPerformance = await AgentState.find(
      agentType ? { agentType } : {},
      'agentType performance health'
    ).lean();
    
    res.status(200).json({
      success: true,
      data: {
        timeRange: `${hours}h`,
        period: { startDate, endDate },
        taskStatistics: taskStats,
        agentPerformance: agentPerformance.map(agent => ({
          agentType: agent.agentType,
          performance: agent.performance,
          health: agent.health
        })),
        summary: {
          totalAgents: agentPerformance.length,
          totalTasks: taskStats.reduce((sum, stat) => sum + stat.totalTasks, 0),
          successRate: calculateOverallSuccessRate(taskStats),
          averageProcessingTime: calculateOverallAverageTime(taskStats)
        }
      }
    });
    
  } catch (error) {
    logger.error('❌ Get agent metrics failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get agent metrics',
      error: error.message
    });
  }
});

/**
 * Restart agent system
 */
const restartAgentSystem = asyncHandler(async (req, res) => {
  try {
    const orchestrator = req.app.get('agentOrchestrator');
    
    if (orchestrator) {
      await orchestrator.shutdown();
    }
    
    // Create new orchestrator
    const newOrchestrator = new AgentOrchestrator();
    await newOrchestrator.initialize();
    
    // Update app reference
    req.app.set('agentOrchestrator', newOrchestrator);
    
    logger.info('🔄 Agent system restarted via API');
    
    res.status(200).json({
      success: true,
      message: 'Agent system restarted successfully',
      data: {
        status: newOrchestrator.getStatus(),
        restartedAt: new Date()
      }
    });
    
  } catch (error) {
    logger.error('❌ Agent system restart failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to restart agent system',
      error: error.message
    });
  }
});

/**
 * Shutdown agent system
 */
const shutdownAgentSystem = asyncHandler(async (req, res) => {
  try {
    const orchestrator = req.app.get('agentOrchestrator');
    
    if (!orchestrator) {
      return res.status(400).json({
        success: false,
        message: 'Agent system is not running'
      });
    }
    
    await orchestrator.shutdown();
    req.app.set('agentOrchestrator', null);
    
    logger.info('🛑 Agent system shutdown via API');
    
    res.status(200).json({
      success: true,
      message: 'Agent system shutdown successfully',
      data: {
        shutdownAt: new Date()
      }
    });
    
  } catch (error) {
    logger.error('❌ Agent system shutdown failed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to shutdown agent system',
      error: error.message
    });
  }
});

// Helper functions

/**
 * Calculate task progress percentage
 */
function calculateTaskProgress(task) {
  switch (task.status) {
    case 'pending':
      return 0;
    case 'processing':
      return 50;
    case 'completed':
      return 100;
    case 'failed':
    case 'cancelled':
      return 0;
    default:
      return 0;
  }
}

/**
 * Get recent task statistics
 */
async function getRecentTaskStats() {
  const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const stats = await AgentTask.aggregate([
    { $match: { createdAt: { $gte: last24Hours } } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
  
  const result = {
    total: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0
  };
  
  stats.forEach(stat => {
    result[stat._id] = stat.count;
    result.total += stat.count;
  });
  
  return result;
}

/**
 * Calculate overall success rate
 */
function calculateOverallSuccessRate(taskStats) {
  const totals = taskStats.reduce((acc, stat) => ({
    total: acc.total + stat.totalTasks,
    completed: acc.completed + stat.completedTasks
  }), { total: 0, completed: 0 });
  
  return totals.total > 0 ? (totals.completed / totals.total) * 100 : 0;
}

/**
 * Calculate overall average processing time
 */
function calculateOverallAverageTime(taskStats) {
  const totals = taskStats.reduce((acc, stat) => ({
    totalTime: acc.totalTime + (stat.totalProcessingTime || 0),
    totalTasks: acc.totalTasks + stat.completedTasks
  }), { totalTime: 0, totalTasks: 0 });
  
  return totals.totalTasks > 0 ? totals.totalTime / totals.totalTasks : 0;
}

module.exports = {
  initializeAgentSystem,
  submitTask,
  getTaskStatus,
  getUserTasks,
  cancelTask,
  getSystemStatus,
  getAgentMetrics,
  restartAgentSystem,
  shutdownAgentSystem
};
