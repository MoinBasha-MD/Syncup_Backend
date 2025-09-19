const asyncHandler = require('express-async-handler');
const StatusTemplate = require('../models/statusTemplateModel');

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
  const { name, status, customStatus, duration } = req.body;

  if (!name || !status || !duration) {
    res.status(400);
    throw new Error('Please provide all required fields');
  }

  const statusTemplate = await StatusTemplate.create({
    user: req.user._id,
    name,
    status,
    customStatus,
    duration,
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

module.exports = {
  getStatusTemplates,
  createStatusTemplate,
  updateStatusTemplate,
  deleteStatusTemplate,
};
