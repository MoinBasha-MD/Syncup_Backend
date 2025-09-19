/**
 * Phone number utility functions
 * Handles normalization and validation of phone numbers
 */

/**
 * Normalize phone number to consistent format
 * @param {string} phoneNumber - Raw phone number input
 * @returns {string} - Normalized phone number
 */
const normalizePhoneNumber = (phoneNumber) => {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return '';
  }

  // Remove all non-digit characters except +
  let normalized = phoneNumber.replace(/[\s\-\(\)\.]/g, '');
  
  // Handle different country code formats
  if (normalized.startsWith('+91')) {
    // Indian number with +91 country code
    normalized = normalized.substring(3);
  } else if (normalized.startsWith('91') && normalized.length === 12) {
    // Indian number with 91 country code (no +)
    normalized = normalized.substring(2);
  } else if (normalized.startsWith('+1') && normalized.length === 12) {
    // US/Canada number with +1 country code
    normalized = normalized.substring(2);
  } else if (normalized.startsWith('1') && normalized.length === 11) {
    // US/Canada number with 1 country code (no +)
    normalized = normalized.substring(1);
  }
  
  // Remove any remaining non-digits
  normalized = normalized.replace(/\D/g, '');
  
  return normalized;
};

/**
 * Validate phone number format
 * @param {string} phoneNumber - Phone number to validate
 * @returns {boolean} - True if valid format
 */
const isValidPhoneNumber = (phoneNumber) => {
  const normalized = normalizePhoneNumber(phoneNumber);
  
  // Check if it's between 7 and 15 digits (international standard)
  if (normalized.length < 7 || normalized.length > 15) {
    return false;
  }
  
  // Check if it contains only digits
  if (!/^\d+$/.test(normalized)) {
    return false;
  }
  
  return true;
};

/**
 * Format phone number for display
 * @param {string} phoneNumber - Normalized phone number
 * @param {string} countryCode - Country code (default: '91' for India)
 * @returns {string} - Formatted phone number
 */
const formatPhoneNumber = (phoneNumber, countryCode = '91') => {
  const normalized = normalizePhoneNumber(phoneNumber);
  
  if (!normalized) {
    return '';
  }
  
  // Format based on country
  if (countryCode === '91' && normalized.length === 10) {
    // Indian format: +91 98765 43210
    return `+91 ${normalized.substring(0, 5)} ${normalized.substring(5)}`;
  } else if (countryCode === '1' && normalized.length === 10) {
    // US format: +1 (555) 123-4567
    return `+1 (${normalized.substring(0, 3)}) ${normalized.substring(3, 6)}-${normalized.substring(6)}`;
  }
  
  // Default format: +countryCode normalized
  return `+${countryCode} ${normalized}`;
};

/**
 * Check if two phone numbers are the same after normalization
 * @param {string} phone1 - First phone number
 * @param {string} phone2 - Second phone number
 * @returns {boolean} - True if they match
 */
const phoneNumbersMatch = (phone1, phone2) => {
  const normalized1 = normalizePhoneNumber(phone1);
  const normalized2 = normalizePhoneNumber(phone2);
  
  return normalized1 === normalized2 && normalized1.length > 0;
};

module.exports = {
  normalizePhoneNumber,
  isValidPhoneNumber,
  formatPhoneNumber,
  phoneNumbersMatch
};
