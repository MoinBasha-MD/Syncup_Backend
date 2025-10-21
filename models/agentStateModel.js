const mongoose = require('mongoose');

const agentStateSchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  agentType: {
    type: String,
    required: true,
    enum: ['scheduling', 'communication', 'search', 'analytics', 'security', 'maintenance', 'personalization'],
    index: true
  },
  
  status: {
    type: String,
    enum: ['initializing', 'active', 'idle', 'busy', 'error', 'maintenance', 'shutdown'],
    default: 'initializing',
    index: true
  },
  
  health: {
    status: {
      type: String,
      enum: ['healthy', 'warning', 'critical', 'unknown'],
      default: 'unknown'
    },
    lastCheck: Date,
    uptime: Number,
    errorCount: {
      type: Number,
      default: 0
    },
    lastError: String
  },
  
  performance: {
    tasksProcessed: {
      type: Number,
      default: 0
    },
    tasksCompleted: {
      type: Number,
      default: 0
    },
    tasksFailed: {
      type: Number,
      default: 0
    },
    averageProcessingTime: {
      type: Number,
      default: 0
    },
    successRate: {
      type: Number,
      default: 100
    },
    throughput: {
      type: Number,
      default: 0
    }
  },
  
  resources: {
    memoryUsage: {
      current: Number,
      peak: Number,
      average: Number
    },
    cpuUsage: {
      current: Number,
      peak: Number,
      average: Number
    },
    activeConnections: Number,
    queueSize: Number
  },
  
  configuration: {
    maxConcurrentTasks: {
      type: Number,
      default: 10
    },
    taskTimeout: {
      type: Number,
      default: 30000 // 30 seconds
    },
    retryAttempts: {
      type: Number,
      default: 3
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    enabled: {
      type: Boolean,
      default: true
    }
  },
  
  capabilities: {
    type: [String],
    default: []
  },
  
  metadata: {
    version: String,
    startTime: Date,
    lastActivity: Date,
    processId: String,
    nodeId: String,
    environment: String
  },
  
  metrics: {
    hourly: [{
      hour: Date,
      tasksProcessed: Number,
      averageTime: Number,
      errorRate: Number
    }],
    daily: [{
      date: Date,
      tasksProcessed: Number,
      averageTime: Number,
      errorRate: Number,
      uptime: Number
    }]
  }
}, {
  timestamps: true,
  collection: 'agent_states'
});

// Indexes for performance
agentStateSchema.index({ agentType: 1, status: 1 });
agentStateSchema.index({ 'health.status': 1 });
agentStateSchema.index({ 'configuration.enabled': 1, status: 1 });

// Static methods
agentStateSchema.statics.findActiveAgents = function(agentType = null) {
  const query = { 
    status: { $in: ['active', 'idle', 'busy'] },
    'configuration.enabled': true
  };
  if (agentType) query.agentType = agentType;
  return this.find(query);
};

agentStateSchema.statics.getSystemHealth = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$agentType',
        totalAgents: { $sum: 1 },
        activeAgents: {
          $sum: {
            $cond: [{ $in: ['$status', ['active', 'idle', 'busy']] }, 1, 0]
          }
        },
        healthyAgents: {
          $sum: {
            $cond: [{ $eq: ['$health.status', 'healthy'] }, 1, 0]
          }
        },
        averageSuccessRate: { $avg: '$performance.successRate' },
        totalTasksProcessed: { $sum: '$performance.tasksProcessed' }
      }
    }
  ]);
};

agentStateSchema.statics.findBestAgent = function(agentType, criteria = {}) {
  const query = {
    agentType,
    status: { $in: ['active', 'idle'] },
    'configuration.enabled': true,
    'health.status': { $in: ['healthy', 'warning'] }
  };
  
  return this.findOne(query)
    .sort({
      'performance.successRate': -1,
      'resources.queueSize': 1,
      'performance.averageProcessingTime': 1
    });
};

// Instance methods
agentStateSchema.methods.updateHealth = function(healthData) {
  this.health = { ...this.health, ...healthData, lastCheck: new Date() };
  return this.save();
};

agentStateSchema.methods.updatePerformance = function(perfData) {
  this.performance = { ...this.performance, ...perfData };
  this.performance.successRate = this.performance.tasksCompleted > 0 
    ? (this.performance.tasksCompleted / this.performance.tasksProcessed) * 100 
    : 100;
  return this.save();
};

agentStateSchema.methods.updateResources = function(resourceData) {
  this.resources = { ...this.resources, ...resourceData };
  return this.save();
};

agentStateSchema.methods.incrementTaskCount = function() {
  this.performance.tasksProcessed += 1;
  this.metadata.lastActivity = new Date();
  return this.save();
};

agentStateSchema.methods.recordTaskCompletion = function(processingTime, success = true) {
  if (success) {
    this.performance.tasksCompleted += 1;
  } else {
    this.performance.tasksFailed += 1;
    this.health.errorCount += 1;
  }
  
  // Update average processing time
  const totalTasks = this.performance.tasksProcessed;
  this.performance.averageProcessingTime = 
    ((this.performance.averageProcessingTime * (totalTasks - 1)) + processingTime) / totalTasks;
  
  this.metadata.lastActivity = new Date();
  return this.save();
};

module.exports = mongoose.model('AgentState', agentStateSchema);
