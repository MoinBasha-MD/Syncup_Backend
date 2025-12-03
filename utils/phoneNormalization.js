/**
 * Phone Number Normalization Utility
 * Handles various phone number formats for consistent matching
 */

/**
 * Normalize a phone number to multiple formats for matching
 * @param {string} phoneNumber - Phone number to normalize
 * @returns {Array<string>} Array of normalized phone number formats
 */
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return [];
  }

  const formats = new Set();

  try {
    // Remove all non-digit characters
    const digitsOnly = phoneNumber.replace(/\D/g, '');

    if (!digitsOnly) {
      return [];
    }

    // Add the original number (cleaned)
    formats.add(digitsOnly);

    // Handle different length scenarios
    if (digitsOnly.length === 10) {
      // Standard 10-digit number (e.g., 9876543210)
      formats.add(digitsOnly);
      
      // Add with country code (India: 91)
      formats.add(`91${digitsOnly}`);
      formats.add(`+91${digitsOnly}`);
      
      // Add with spaces (common format)
      formats.add(`+91 ${digitsOnly}`);
      formats.add(`91 ${digitsOnly}`);
      
    } else if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
      // 12-digit with country code (e.g., 919876543210)
      formats.add(digitsOnly);
      formats.add(`+${digitsOnly}`);
      
      // Add without country code
      const without91 = digitsOnly.substring(2);
      formats.add(without91);
      
      // Add with spaces
      formats.add(`+91 ${without91}`);
      formats.add(`91 ${without91}`);
      
    } else if (digitsOnly.length === 13 && digitsOnly.startsWith('91')) {
      // 13-digit (e.g., +919876543210 becomes 919876543210)
      const without91 = digitsOnly.substring(2);
      formats.add(without91);
      formats.add(`91${without91}`);
      formats.add(`+91${without91}`);
      formats.add(`+91 ${without91}`);
      
    } else if (digitsOnly.length > 10) {
      // For any other format, try last 10 digits
      const last10 = digitsOnly.slice(-10);
      formats.add(last10);
      formats.add(`91${last10}`);
      formats.add(`+91${last10}`);
      formats.add(`+91 ${last10}`);
      
      // Also add the full number
      formats.add(digitsOnly);
      if (!digitsOnly.startsWith('+')) {
        formats.add(`+${digitsOnly}`);
      }
    }

    // Add the original number with + if it had one
    if (phoneNumber.includes('+')) {
      formats.add(phoneNumber.trim());
      formats.add(phoneNumber.replace(/\s/g, ''));
    }

    // Add common formatting variations
    const base10 = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;
    if (base10.length === 10) {
      // Add formatted versions
      formats.add(`+91-${base10}`);
      formats.add(`+91 ${base10.substring(0, 5)} ${base10.substring(5)}`);
      formats.add(`(+91) ${base10}`);
    }

  } catch (error) {
    console.error('Error normalizing phone number:', phoneNumber, error);
  }

  return Array.from(formats);
}

/**
 * Get the canonical (standard) format for a phone number
 * Returns the 10-digit number without country code
 * @param {string} phoneNumber - Phone number to normalize
 * @returns {string} Canonical phone number (10 digits)
 */
function getCanonicalPhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return '';
  }

  try {
    // Remove all non-digit characters
    const digitsOnly = phoneNumber.replace(/\D/g, '');

    if (!digitsOnly) {
      return '';
    }

    // For Indian numbers
    if (digitsOnly.length === 10) {
      return digitsOnly;
    } else if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
      return digitsOnly.substring(2);
    } else if (digitsOnly.length > 10) {
      // Return last 10 digits
      return digitsOnly.slice(-10);
    }

    return digitsOnly;
  } catch (error) {
    console.error('Error getting canonical phone number:', phoneNumber, error);
    return '';
  }
}

/**
 * Create a MongoDB query to match phone numbers in various formats
 * @param {Array<string>} phoneNumbers - Array of phone numbers to match
 * @returns {Object} MongoDB query object
 */
function createPhoneNumberQuery(phoneNumbers) {
  if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
    return { phoneNumber: { $in: [] } };
  }

  // Collect all possible formats for all phone numbers
  const allFormats = new Set();
  
  phoneNumbers.forEach(phone => {
    const formats = normalizePhoneNumber(phone);
    formats.forEach(format => allFormats.add(format));
  });

  console.log(`📞 [PHONE NORMALIZATION] Original: ${phoneNumbers.length} numbers, Expanded to: ${allFormats.size} formats`);
  
  // Log sample formats for debugging
  if (phoneNumbers.length > 0) {
    const sampleFormats = normalizePhoneNumber(phoneNumbers[0]);
    console.log(`📞 [SAMPLE] "${phoneNumbers[0]}" → [${sampleFormats.slice(0, 5).join(', ')}...]`);
  }

  return {
    phoneNumber: { $in: Array.from(allFormats) }
  };
}

module.exports = {
  normalizePhoneNumber,
  getCanonicalPhoneNumber,
  createPhoneNumberQuery
};
