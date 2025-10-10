const asyncHandler = require('express-async-handler');
const StatusSchedule = require('../models/statusScheduleModel');
const StatusTemplate = require('../models/statusTemplateModel');
const StatusScheduler = require('../utils/statusScheduler');
const { addDays, addWeeks, addMonths, format, startOfWeek, endOfWeek, isWithinInterval } = require('date-fns');

// @desc    Get user status schedules
// @route   GET /api/status/schedules
// @access  Private
const getStatusSchedules = asyncHandler(async (req, res) => {
  const statusSchedules = await StatusSchedule.find({ 
    user: req.user._id,
    active: true
  }).sort({ startTime: 1 });
  
  res.json(statusSchedules);
});

// @desc    Create new status schedule
// @route   POST /api/status/schedules
// @access  Private
const createStatusSchedule = asyncHandler(async (req, res) => {
  const { 
    status, 
    customStatus, 
    startTime, 
    endTime, 
    repeat, 
    notes, 
    duration, 
    recurrenceConfig,
    active = true 
  } = req.body;

  if (!status || !startTime || !endTime) {
    res.status(400);
    throw new Error('Please provide all required fields');
  }

  // Validate start and end times
  const start = new Date(startTime);
  const end = new Date(endTime);
  
  if (start >= end) {
    res.status(400);
    throw new Error('Start time must be before end time');
  }

  // Validate recurrence configuration if provided
  if (recurrenceConfig) {
    if (recurrenceConfig.endDate) {
      const recurrenceEnd = new Date(recurrenceConfig.endDate);
      if (recurrenceEnd <= start) {
        res.status(400);
        throw new Error('Recurrence end date must be after start time');
      }
    }
    
    if (recurrenceConfig.maxOccurrences && recurrenceConfig.maxOccurrences < 1) {
      res.status(400);
      throw new Error('Maximum occurrences must be at least 1');
    }
  }

  const statusSchedule = await StatusSchedule.create({
    user: req.user._id,
    userId: req.user.userId, // Add userId field
    status,
    customStatus,
    startTime,
    endTime,
    repeat: repeat || 'none',
    notes: notes || null,
    duration: duration || Math.round((end.getTime() - start.getTime()) / (1000 * 60)), // Calculate duration in minutes
    recurrenceConfig: recurrenceConfig || {},
    active,
  });

  if (statusSchedule) {
    res.status(201).json(statusSchedule);
  } else {
    res.status(400);
    throw new Error('Invalid status schedule data');
  }
});

// @desc    Update status schedule
// @route   PUT /api/status/schedules/:id
// @access  Private
const updateStatusSchedule = asyncHandler(async (req, res) => {
  const { 
    status, 
    customStatus, 
    startTime, 
    endTime, 
    repeat, 
    active, 
    notes, 
    duration, 
    recurrenceConfig 
  } = req.body;
  
  const statusSchedule = await StatusSchedule.findById(req.params.id);

  if (!statusSchedule) {
    res.status(404);
    throw new Error('Status schedule not found');
  }

  // Check if the status schedule belongs to the logged-in user
  if (statusSchedule.user.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error('Not authorized to update this status schedule');
  }

  // Validate times if being updated
  if (startTime && endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    if (start >= end) {
      res.status(400);
      throw new Error('Start time must be before end time');
    }
  }

  // Update fields
  statusSchedule.status = status || statusSchedule.status;
  statusSchedule.customStatus = customStatus !== undefined ? customStatus : statusSchedule.customStatus;
  statusSchedule.startTime = startTime || statusSchedule.startTime;
  statusSchedule.endTime = endTime || statusSchedule.endTime;
  statusSchedule.repeat = repeat || statusSchedule.repeat;
  statusSchedule.notes = notes !== undefined ? notes : statusSchedule.notes;
  statusSchedule.duration = duration !== undefined ? duration : statusSchedule.duration;
  statusSchedule.recurrenceConfig = recurrenceConfig !== undefined ? recurrenceConfig : statusSchedule.recurrenceConfig;
  
  // Only update active status if explicitly provided
  if (active !== undefined) {
    statusSchedule.active = active;
  }

  const updatedStatusSchedule = await statusSchedule.save();
  res.json(updatedStatusSchedule);
});

// @desc    Delete status schedule
// @route   DELETE /api/status/schedules/:id
// @access  Private
const deleteStatusSchedule = asyncHandler(async (req, res) => {
  const statusSchedule = await StatusSchedule.findById(req.params.id);

  if (!statusSchedule) {
    res.status(404);
    throw new Error('Status schedule not found');
  }

  // Check if the status schedule belongs to the logged-in user
  if (statusSchedule.user.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error('Not authorized to delete this status schedule');
  }

  await statusSchedule.remove();
  res.json({ message: 'Status schedule removed' });
});

// 🆕 @desc    Create status schedule from template
// @route   POST /api/status/schedules/from-template
// @access  Private
const createScheduleFromTemplate = asyncHandler(async (req, res) => {
  const { templateId, startTime, customizations } = req.body;

  if (!templateId || !startTime) {
    res.status(400);
    throw new Error('Template ID and start time are required');
  }

  // Get the template
  const template = await StatusTemplate.findById(templateId);
  if (!template) {
    res.status(404);
    throw new Error('Template not found');
  }

  // Check if template belongs to user or is public/system template
  if (template.user.toString() !== req.user._id.toString() && 
      !template.isPublic && !template.isSystemTemplate) {
    res.status(401);
    throw new Error('Not authorized to use this template');
  }

  // Calculate end time based on template duration
  const startDate = new Date(startTime);
  const endDate = new Date(startDate.getTime() + (template.duration * 60 * 1000));

  // Create schedule with template data and customizations
  const scheduleData = {
    user: req.user._id,
    userId: req.user.userId,
    status: customizations?.status || template.status,
    customStatus: customizations?.customStatus || template.customStatus,
    startTime: startDate,
    endTime: endDate,
    templateId: template._id,
    templateName: template.name,
    appliedBy: 'template',
    color: template.color,
    tags: template.tags,
    ...customizations
  };

  const statusSchedule = await StatusSchedule.create(scheduleData);

  // Update template usage statistics
  await StatusTemplate.findByIdAndUpdate(templateId, {
    $inc: { usageCount: 1 },
    lastUsed: new Date()
  });

  res.status(201).json(statusSchedule);
});

// 🆕 @desc    Create recurring schedules with advanced patterns
// @route   POST /api/status/schedules/recurring
// @access  Private
const createRecurringSchedule = asyncHandler(async (req, res) => {
  const { 
    status, 
    customStatus, 
    startTime, 
    endTime, 
    repeat, 
    recurrenceConfig,
    templateId 
  } = req.body;

  console.log('🔄 Creating recurring schedule with data:', {
    status,
    startTime,
    endTime,
    repeat,
    recurrenceConfig,
    templateId
  });

  if (!status || !startTime || !endTime || !repeat) {
    res.status(400);
    throw new Error('Please provide all required fields');
  }

  // Generate recurring instances based on pattern
  const instances = generateRecurringInstances({
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    repeat,
    recurrenceConfig
  });

  console.log(`📅 Generated ${instances.length} recurring instances:`, instances.map(i => ({
    startTime: i.startTime.toISOString(),
    endTime: i.endTime.toISOString()
  })));

  const createdSchedules = [];

  for (const instance of instances) {
    const scheduleData = {
      user: req.user._id,
      userId: req.user.userId,
      status,
      customStatus,
      startTime: instance.startTime,
      endTime: instance.endTime,
      repeat,
      recurrenceConfig,
      templateId,
      active: true
    };

    const schedule = await StatusSchedule.create(scheduleData);
    createdSchedules.push(schedule);
  }

  res.status(201).json({
    success: true,
    count: createdSchedules.length,
    data: createdSchedules
  });
});

// 🆕 @desc    Get status templates
// @route   GET /api/status/templates
// @access  Private
const getStatusTemplates = asyncHandler(async (req, res) => {
  const { category, includeSystem = true, includePublic = true } = req.query;

  let query = {
    $or: [
      { user: req.user._id }, // User's own templates
    ]
  };

  if (includeSystem === 'true') {
    query.$or.push({ isSystemTemplate: true });
  }

  if (includePublic === 'true') {
    query.$or.push({ isPublic: true });
  }

  if (category) {
    query.category = category;
  }

  const templates = await StatusTemplate.find(query)
    .sort({ usageCount: -1, createdAt: -1 });

  res.json({
    success: true,
    data: templates
  });
});

// 🆕 @desc    Create status template
// @route   POST /api/status/templates
// @access  Private
const createStatusTemplate = asyncHandler(async (req, res) => {
  const templateData = {
    ...req.body,
    user: req.user._id,
    userId: req.user.userId,
    usageCount: 0
  };

  const template = await StatusTemplate.create(templateData);
  res.status(201).json(template);
});

// 🆕 @desc    Get status analytics
// @route   GET /api/status/analytics
// @access  Private
const getStatusAnalytics = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  const end = endDate ? new Date(endDate) : new Date();

  // Get completed schedules in date range
  const schedules = await StatusSchedule.find({
    user: req.user._id,
    actualStartTime: { $exists: true },
    actualEndTime: { $exists: true },
    actualStartTime: { $gte: start, $lte: end }
  });

  // Calculate analytics
  const analytics = calculateStatusAnalytics(schedules);

  res.json({
    success: true,
    data: analytics,
    dateRange: { start, end }
  });
});

// Helper function to generate recurring instances
function generateRecurringInstances({ startTime, endTime, repeat, recurrenceConfig }) {
  console.log('🔧 generateRecurringInstances called with:', {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    repeat,
    recurrenceConfig
  });

  const instances = [];
  const duration = endTime.getTime() - startTime.getTime();
  
  const maxInstances = recurrenceConfig?.maxOccurrences || 52; // Default max 52 instances
  const endDate = recurrenceConfig?.endDate ? new Date(recurrenceConfig.endDate) : 
                  addMonths(startTime, 12); // Default 1 year
  const interval = recurrenceConfig?.interval || 1;
  const exceptions = recurrenceConfig?.exceptions || [];

  console.log('📊 Recurrence parameters:', {
    maxInstances,
    endDate: endDate.toISOString(),
    interval,
    exceptionsCount: exceptions.length
  });

  let currentStart = new Date(startTime);
  let count = 0;

  while (currentStart <= endDate && count < maxInstances) {
    // Check if this date is in exceptions
    const isException = exceptions.some(exception => 
      format(new Date(exception), 'yyyy-MM-dd') === format(currentStart, 'yyyy-MM-dd')
    );

    if (!isException) {
      // Check if this instance matches the recurrence pattern
      if (matchesRecurrencePattern(currentStart, repeat, recurrenceConfig)) {
        instances.push({
          startTime: new Date(currentStart),
          endTime: new Date(currentStart.getTime() + duration)
        });
        count++;
      }
    }

    // Move to next occurrence based on repeat pattern
    currentStart = getNextOccurrence(currentStart, repeat, interval);
  }

  return instances;
}

// Helper function to check if date matches recurrence pattern
function matchesRecurrencePattern(date, repeat, config) {
  switch (repeat) {
    case 'daily':
      return true;
    case 'weekdays':
      const weekday = date.getDay();
      return weekday >= 1 && weekday <= 5; // Monday to Friday
    case 'weekends':
      const weekend = date.getDay();
      return weekend === 0 || weekend === 6; // Sunday or Saturday
    case 'weekly':
      return true;
    case 'custom_days':
      return config?.daysOfWeek?.includes(date.getDay());
    default:
      return true;
  }
}

// Helper function to get next occurrence
function getNextOccurrence(date, repeat, interval) {
  switch (repeat) {
    case 'daily':
    case 'weekdays':
    case 'weekends':
      return addDays(date, interval);
    case 'weekly':
    case 'custom_days':
      return addWeeks(date, interval);
    case 'biweekly':
      return addWeeks(date, 2 * interval);
    case 'monthly':
      return addMonths(date, interval);
    default:
      return addDays(date, interval);
  }
}

// Helper function to calculate status analytics
function calculateStatusAnalytics(schedules) {
  const analytics = {
    totalSchedules: schedules.length,
    timeSpentByStatus: {},
    mostUsedStatuses: [],
    peakBusyHours: [],
    weeklyPatterns: {},
    averageDuration: 0,
    completionRate: 0
  };

  if (schedules.length === 0) return analytics;

  let totalDuration = 0;
  const statusDurations = {};
  const hourCounts = Array(24).fill(0);
  const dayPatterns = {};

  schedules.forEach(schedule => {
    const duration = (new Date(schedule.actualEndTime) - new Date(schedule.actualStartTime)) / (1000 * 60); // minutes
    totalDuration += duration;

    // Time spent by status
    if (!statusDurations[schedule.status]) {
      statusDurations[schedule.status] = 0;
    }
    statusDurations[schedule.status] += duration;

    // Peak busy hours
    const hour = new Date(schedule.actualStartTime).getHours();
    hourCounts[hour]++;

    // Weekly patterns
    const day = new Date(schedule.actualStartTime).getDay();
    if (!dayPatterns[day]) {
      dayPatterns[day] = [];
    }
    dayPatterns[day].push(schedule.status);
  });

  analytics.timeSpentByStatus = statusDurations;
  analytics.averageDuration = totalDuration / schedules.length;
  analytics.mostUsedStatuses = Object.entries(statusDurations)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([status]) => status);
  
  // Find peak hours (top 3 busiest hours)
  analytics.peakBusyHours = hourCounts
    .map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(item => item.hour);

  analytics.weeklyPatterns = dayPatterns;

  return analytics;
}

// @desc    Get upcoming status schedules
// @route   GET /api/status/schedules/upcoming
// @access  Private
const getUpcomingStatusSchedules = asyncHandler(async (req, res) => {
  const now = new Date();
  
  // Get all active schedules that start in the future or are recurring
  const statusSchedules = await StatusSchedule.find({
    user: req.user._id,
    active: true,
    $or: [
      { startTime: { $gte: now } },
      { repeat: { $ne: 'none' } }
    ]
  }).sort({ startTime: 1 }).limit(5);
  
  res.json(statusSchedules);
});

// @desc    Get expanded recurring schedules for calendar view
// @route   GET /api/status/schedules/expanded
// @access  Private
const getExpandedSchedules = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  if (!startDate || !endDate) {
    res.status(400);
    throw new Error('Start date and end date are required');
  }
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Get all active schedules
  const schedules = await StatusSchedule.find({
    user: req.user._id,
    active: true
  });
  
  const expandedSchedules = [];
  
  for (const schedule of schedules) {
    if (schedule.repeat === 'none') {
      // For non-recurring schedules, include if within date range
      const scheduleStart = new Date(schedule.startTime);
      const scheduleEnd = new Date(schedule.endTime);
      
      if (scheduleStart <= end && scheduleEnd >= start) {
        expandedSchedules.push(schedule);
      }
    } else {
      // For recurring schedules, generate instances
      const instances = StatusScheduler.generateRecurringInstances(schedule, start, end);
      expandedSchedules.push(...instances);
    }
  }
  
  // Sort by start time
  expandedSchedules.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  
  res.json(expandedSchedules);
});

module.exports = {
  getStatusSchedules,
  createStatusSchedule,
  updateStatusSchedule,
  deleteStatusSchedule,
  getUpcomingStatusSchedules,
  getExpandedSchedules,
  // 🆕 Enhanced functions
  createScheduleFromTemplate,
  createRecurringSchedule,
  getStatusTemplates,
  createStatusTemplate,
  getStatusAnalytics,
};
