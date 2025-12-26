const asyncHandler = require('express-async-handler');
const StatusTemplate = require('../models/statusTemplateModel');
const StatusHistory = require('../models/statusHistoryModel');
const User = require('../models/userModel');

// @desc    Get user status templates
// @route   GET /api/status/templates
// @access  Private
const getStatusTemplates = asyncHandler(async (req, res) => {
  const statusTemplates = await StatusTemplate.find({ user: req.user._id });
  res.json(statusTemplates);
});

// @desc    Create new status template
// @route   POST /api/status/templates
// @access  Private
const createStatusTemplate = asyncHandler(async (req, res) => {
  const { 
    name, status, customStatus, duration,
    // NEW: Hierarchical status
    mainStatus, mainDuration, mainDurationLabel,
    subStatus, subDuration, subDurationLabel,
    location
  } = req.body;

  // FIXED: Allow custom status without duration (for status templates)
  // Allow custom duration without status (for duration templates)
  if (!name) {
    res.status(400);
    throw new Error('Name is required');
  }

  // At least one of status or duration must be provided
  if (!status && !mainStatus && !duration && !mainDuration) {
    res.status(400);
    throw new Error('Please provide either status or duration');
  }

  const user = await User.findById(req.user._id);

  const statusTemplate = await StatusTemplate.create({
    user: req.user._id,
    userId: user.userId,
    name,
    // OLD FORMAT
    status: status || mainStatus,
    customStatus: customStatus || mainStatus,
    duration: duration || mainDuration,
    // NEW: Hierarchical
    mainStatus: mainStatus || status,
    mainDuration: mainDuration || duration,
    mainDurationLabel: mainDurationLabel || `${mainDuration || duration} min`,
    subStatus,
    subDuration,
    subDurationLabel,
    location
  });

  if (statusTemplate) {
    res.status(201).json(statusTemplate);
  } else {
    res.status(400);
    throw new Error('Invalid status template data');
  }
});

// @desc    Update status template
// @route   PUT /api/status/templates/:id
// @access  Private
const updateStatusTemplate = asyncHandler(async (req, res) => {
  const { name, status, customStatus, duration } = req.body;
  
  const statusTemplate = await StatusTemplate.findById(req.params.id);

  if (!statusTemplate) {
    res.status(404);
    throw new Error('Status template not found');
  }

  // Check if the status template belongs to the logged-in user
  if (statusTemplate.user.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error('Not authorized to update this status template');
  }

  statusTemplate.name = name || statusTemplate.name;
  statusTemplate.status = status || statusTemplate.status;
  statusTemplate.customStatus = customStatus || statusTemplate.customStatus;
  statusTemplate.duration = duration || statusTemplate.duration;

  const updatedStatusTemplate = await statusTemplate.save();
  res.json(updatedStatusTemplate);
});

// @desc    Delete status template
// @route   DELETE /api/status/templates/:id
// @access  Private
const deleteStatusTemplate = asyncHandler(async (req, res) => {
  const statusTemplate = await StatusTemplate.findById(req.params.id);

  if (!statusTemplate) {
    res.status(404);
    throw new Error('Status template not found');
  }

  // Check if the status template belongs to the logged-in user
  if (statusTemplate.user.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error('Not authorized to delete this status template');
  }

  await statusTemplate.remove();
  res.json({ message: 'Status template removed' });
});

// @desc    Auto-generate templates based on user patterns
// @route   POST /api/status/templates/auto-generate
// @access  Private
const autoGenerateTemplates = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  
  // Get last 30 days of status history
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const statusHistory = await StatusHistory.find({
    user: req.user._id,
    startTime: { $gte: thirtyDaysAgo }
  });
  
  console.log(`🤖 [AI TEMPLATE] Analyzing ${statusHistory.length} status records for user ${user.userId}`);
  
  // Group by similar patterns
  const patterns = {};
  
  statusHistory.forEach(status => {
    const key = `${status.status}_${status.duration}`;
    
    if (!patterns[key]) {
      patterns[key] = {
        status: status.status,
        customStatus: status.customStatus,
        duration: status.duration,
        count: 0,
        days: new Set(),
        hours: []
      };
    }
    
    patterns[key].count++;
    patterns[key].days.add(new Date(status.startTime).getDay());
    patterns[key].hours.push(new Date(status.startTime).getHours());
  });
  
  // Filter patterns with high frequency (used 5+ times)
  const frequentPatterns = Object.values(patterns)
    .filter(p => p.count >= 5)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5); // Top 5 patterns
  
  console.log(`🤖 [AI TEMPLATE] Found ${frequentPatterns.length} frequent patterns`);
  
  // Create templates
  const createdTemplates = [];
  
  for (const pattern of frequentPatterns) {
    const templateName = generateTemplateName(pattern);
    
    // Check if template already exists
    const existing = await StatusTemplate.findOne({
      user: req.user._id,
      name: templateName,
      autoCreated: true
    });
    
    if (!existing) {
      const template = await StatusTemplate.create({
        user: req.user._id,
        userId: user.userId,
        name: templateName,
        status: pattern.status,
        customStatus: pattern.customStatus,
        duration: pattern.duration,
        mainStatus: pattern.customStatus || pattern.status,
        mainDuration: pattern.duration,
        mainDurationLabel: formatDuration(pattern.duration),
        autoCreated: true,
        pattern: `Used ${pattern.count} times`,
        confidence: Math.min(pattern.count / 20, 1),
        patternData: {
          frequency: pattern.count,
          daysOfWeek: Array.from(pattern.days),
          timeOfDay: pattern.hours
        }
      });
      
      createdTemplates.push(template);
      console.log(`✅ [AI TEMPLATE] Created: ${templateName}`);
    }
  }
  
  res.json({
    success: true,
    templatesCreated: createdTemplates.length,
    templates: createdTemplates
  });
});

// Helper function to generate template name
function generateTemplateName(pattern) {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const days = Array.from(pattern.days).map(d => dayNames[d]);
  
  if (days.length === 5 && !days.includes('Saturday') && !days.includes('Sunday')) {
    return `Weekday ${pattern.status}`;
  } else if (days.length === 2 && days.includes('Saturday') && days.includes('Sunday')) {
    return `Weekend ${pattern.status}`;
  } else {
    return pattern.status;
  }
}

// Helper function to format duration
function formatDuration(minutes) {
  if (minutes < 60) {
    return `${minutes} min`;
  } else {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
    return `${hours}h ${mins}m`;
  }
}

module.exports = {
  getStatusTemplates,
  createStatusTemplate,
  updateStatusTemplate,
  deleteStatusTemplate,
  autoGenerateTemplates,
};
