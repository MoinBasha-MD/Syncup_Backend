const asyncHandler = require('express-async-handler');
const { BadRequestError } = require('../utils/errorClasses');
const {
  getProfile,
  activateProfile,
  updateSettings,
  profileDto,
} = require('../services/syncSpaceIdentity');

const userView = (req) => ({
  userId: req.user.userId,
  name: req.user.name || 'User',
  username: req.user.username || '',
});

const respond = (req, res, profile) =>
  res.json({ success: true, user: userView(req), profile: profileDto(profile) });

const getMe = asyncHandler(async (req, res) => {
  respond(req, res, await getProfile(req.user.userId));
});

const activate = asyncHandler(async (req, res) => {
  const body = req.body;
  if (
    body !== undefined &&
    body !== null &&
    (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0)
  ) {
    throw new BadRequestError('Activation does not accept any fields');
  }
  respond(req, res, await activateProfile(req.user.userId));
});

const updateSettingsHandler = asyncHandler(async (req, res) => {
  respond(req, res, await updateSettings(req.user.userId, req.body));
});

module.exports = {
  getMe,
  activate,
  updateSettings: updateSettingsHandler,
};
