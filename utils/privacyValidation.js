/**
 * Privacy Settings Validation Utilities
 */

const mongoose = require('mongoose');

/**
 * Validate privacy settings object
 */
const validatePrivacySettings = (settings) => {
  const errors = [];

  // Check required fields
  if (!settings.visibility) {
    errors.push('Visibility is required');
  }

  // Validate visibility values (must match the enum in statusPrivacyModel.js)
  const validVisibilities = ['public', 'contacts_only', 'app_connections_only', 'selected_groups', 'custom_list', 'private', 'friends'];
  if (settings.visibility && !validVisibilities.includes(settings.visibility)) {
    errors.push(`Invalid visibility. Must be one of: ${validVisibilities.join(', ')}`);
  }

  // Validate arrays
  if (settings.allowedGroups && !Array.isArray(settings.allowedGroups)) {
    errors.push('allowedGroups must be an array');
  }

  if (settings.allowedContacts && !Array.isArray(settings.allowedContacts)) {
    errors.push('allowedContacts must be an array');
  }

  if (settings.blockedContacts && !Array.isArray(settings.blockedContacts)) {
    errors.push('blockedContacts must be an array');
  }

  // Validate ObjectIds in arrays (skip validation if arrays are empty)
  if (settings.allowedGroups && settings.allowedGroups.length > 0) {
    settings.allowedGroups.forEach((id, index) => {
      if (id && !mongoose.Types.ObjectId.isValid(id)) {
        errors.push(`Invalid ObjectId in allowedGroups at index ${index}: ${id}`);
      }
    });
  }

  if (settings.allowedContacts && settings.allowedContacts.length > 0) {
    settings.allowedContacts.forEach((id, index) => {
      if (id && !mongoose.Types.ObjectId.isValid(id)) {
        errors.push(`Invalid ObjectId in allowedContacts at index ${index}: ${id}`);
      }
    });
  }

  // Validate location sharing
  if (settings.locationSharing) {
    const validLocationSharing = ['none', 'groups', 'contacts', 'all'];
    if (settings.locationSharing.shareWith && !validLocationSharing.includes(settings.locationSharing.shareWith)) {
      errors.push(`Invalid location sharing setting. Must be one of: ${validLocationSharing.join(', ')}`);
    }

    if (settings.locationSharing.enabled !== undefined && typeof settings.locationSharing.enabled !== 'boolean') {
      errors.push('locationSharing.enabled must be a boolean');
    }
  }

  // Check for logical inconsistencies (allow empty arrays for groups/contacts visibility)
  // This allows users to set visibility to groups/contacts even if no specific groups/contacts are selected yet
  // The frontend can handle this gracefully by showing appropriate UI states

  // Check array size limits (prevent DoS attacks)
  const MAX_ARRAY_SIZE = 1000;
  if (settings.allowedGroups && settings.allowedGroups.length > MAX_ARRAY_SIZE) {
    errors.push(`allowedGroups array too large. Maximum ${MAX_ARRAY_SIZE} items allowed`);
  }

  if (settings.allowedContacts && settings.allowedContacts.length > MAX_ARRAY_SIZE) {
    errors.push(`allowedContacts array too large. Maximum ${MAX_ARRAY_SIZE} items allowed`);
  }

  if (settings.blockedContacts && settings.blockedContacts.length > MAX_ARRAY_SIZE) {
    errors.push(`blockedContacts array too large. Maximum ${MAX_ARRAY_SIZE} items allowed`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Sanitize privacy settings by removing invalid data
 */
const sanitizePrivacySettings = (settings) => {
  const sanitized = { ...settings };

  // Set defaults
  sanitized.allowedGroups = sanitized.allowedGroups || [];
  sanitized.allowedContacts = sanitized.allowedContacts || [];
  sanitized.blockedContacts = sanitized.blockedContacts || [];

  if (!sanitized.locationSharing) {
    sanitized.locationSharing = {
      enabled: true,
      shareWith: 'all',
      allowedGroups: [],
      allowedContacts: []
    };
  }

  // Filter out invalid ObjectIds
  sanitized.allowedGroups = sanitized.allowedGroups.filter(id => 
    mongoose.Types.ObjectId.isValid(id)
  );

  sanitized.allowedContacts = sanitized.allowedContacts.filter(id => 
    mongoose.Types.ObjectId.isValid(id)
  );

  sanitized.blockedContacts = sanitized.blockedContacts.filter(id => 
    mongoose.Types.ObjectId.isValid(id)
  );

  // Remove duplicates
  sanitized.allowedGroups = [...new Set(sanitized.allowedGroups)];
  sanitized.allowedContacts = [...new Set(sanitized.allowedContacts)];
  sanitized.blockedContacts = [...new Set(sanitized.blockedContacts)];

  // Enforce size limits
  const MAX_ARRAY_SIZE = 1000;
  sanitized.allowedGroups = sanitized.allowedGroups.slice(0, MAX_ARRAY_SIZE);
  sanitized.allowedContacts = sanitized.allowedContacts.slice(0, MAX_ARRAY_SIZE);
  sanitized.blockedContacts = sanitized.blockedContacts.slice(0, MAX_ARRAY_SIZE);

  return sanitized;
};

/**
 * Check if user has permission to modify privacy settings
 */
const canModifyPrivacySettings = async (userId, targetUserId) => {
  // Users can only modify their own privacy settings
  return userId.toString() === targetUserId.toString();
};

/**
 * Rate limiting for privacy operations
 */
const privacyRateLimits = new Map();

const checkPrivacyRateLimit = (userId, operation = 'default') => {
  const key = `${userId}_${operation}`;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 30; // Max 30 requests per minute

  if (!privacyRateLimits.has(key)) {
    privacyRateLimits.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  const limit = privacyRateLimits.get(key);
  
  if (now > limit.resetTime) {
    // Reset the window
    privacyRateLimits.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (limit.count >= maxRequests) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetTime: limit.resetTime 
    };
  }

  limit.count++;
  return { 
    allowed: true, 
    remaining: maxRequests - limit.count 
  };
};

module.exports = {
  validatePrivacySettings,
  sanitizePrivacySettings,
  canModifyPrivacySettings,
  checkPrivacyRateLimit
};
