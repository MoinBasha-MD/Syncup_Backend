const mongoose = require('mongoose');

const agentTaskSchema = new mongoose.Schema({
  taskId: {
    type: String,
    required: true,
    unique: true,
    default: () => `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  
  agentType: {
    type: String,
    required: true,
    enum: ['scheduling', 'communication', 'search', 'analytics', 'security', 'maintenance', 'personalization'],
    index: true
  },
  
  agentId: {
    type: String,
    required: true,
    index: true
  },
  
  taskType: {
    type: String,
    required: true,
    enum: ['process', 'analyze', 'monitor', 'optimize', 'alert', 'schedule', 'communicate']
  },
  
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent', 'critical'],
    default: 'medium',
    index: true
  },
  
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  
  context: {
    userId: String,
    sessionId: String,
    requestId: String,
    source: String,
    metadata: mongoose.Schema.Types.Mixed
  },
  
  execution: {
    startTime: Date,
    endTime: Date,
    duration: Number,
    attempts: {
      type: Number,
      default: 0
    },
    maxAttempts: {
      type: Number,
      default: 3
    },
    lastError: String
  },
  
  result: {
    success: Boolean,
    data: mongoose.Schema.Types.Mixed,
    error: String,
    metrics: {
      processingTime: Number,
      memoryUsed: Number,
      cpuUsed: Number
    }
  },
  
  dependencies: [{
    taskId: String,
    status: String
  }],
  
  scheduledFor: {
    type: Date,
    index: true
  },
  
  expiresAt: {
    type: Date,
    index: true
  }
}, {
  timestamps: true,
  collection: 'agent_tasks'
});

// Indexes for performance
agentTaskSchema.index({ agentType: 1, status: 1 });
agentTaskSchema.index({ priority: 1, createdAt: 1 });
agentTaskSchema.index({ scheduledFor: 1, status: 1 });
agentTaskSchema.index({ 'context.userId': 1, status: 1 });

// TTL index for automatic cleanup of old completed tasks
agentTaskSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }); // 7 days

// Static methods
agentTaskSchema.statics.findByAgent = function(agentId, status = null) {
  const query = { agentId };
  if (status) query.status = status;
  return this.find(query).sort({ priority: -1, createdAt: 1 });
};

agentTaskSchema.statics.findByType = function(agentType, status = null) {
  const query = { agentType };
  if (status) query.status = status;
  return this.find(query).sort({ priority: -1, createdAt: 1 });
};

agentTaskSchema.statics.getTaskStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: { agentType: '$agentType', status: '$status' },
        count: { $sum: 1 },
        avgDuration: { $avg: '$execution.duration' }
      }
    }
  ]);
};

// Instance methods
agentTaskSchema.methods.markStarted = function() {
  this.status = 'processing';
  this.execution.startTime = new Date();
  this.execution.attempts += 1;
  return this.save();
};

agentTaskSchema.methods.markCompleted = function(result) {
  this.status = 'completed';
  this.execution.endTime = new Date();
  this.execution.duration = this.execution.endTime - this.execution.startTime;
  this.result = { success: true, ...result };
  return this.save();
};

agentTaskSchema.methods.markFailed = function(error, retry = true) {
  if (retry && this.execution.attempts < this.execution.maxAttempts) {
    this.status = 'pending';
    this.execution.lastError = error;
  } else {
    this.status = 'failed';
    this.result = { success: false, error };
  }
  return this.save();
};

module.exports = mongoose.model('AgentTask', agentTaskSchema);
