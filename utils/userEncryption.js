const crypto = require('crypto');

/**
 * User Data Encryption Utility
 * Encrypts sensitive user fields (email, phone, password) while keeping username visible
 * Uses AES-256-GCM for encryption with per-field unique IVs
 */

// Get encryption key from environment or generate one
const ENCRYPTION_KEY = process.env.USER_ENCRYPTION_KEY || crypto.randomBytes(32);

if (!process.env.USER_ENCRYPTION_KEY) {
  console.warn('⚠️  USER_ENCRYPTION_KEY not set in .env - using temporary key (data will be lost on restart)');
  console.warn('⚠️  Generate a key with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"');
}

/**
 * Encrypt a field value
 * @param {string} value - Plain text value to encrypt
 * @returns {object} - { encrypted: string, iv: string, authTag: string }
 */
function encryptField(value) {
  if (!value) return null;
  
  try {
    // Generate unique IV for this field
    const iv = crypto.randomBytes(16);
    
    // Create cipher
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    
    // Encrypt the value
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get authentication tag
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (error) {
    console.error('❌ Encryption error:', error);
    throw new Error('Failed to encrypt field');
  }
}

/**
 * Decrypt a field value
 * @param {object} encryptedData - { encrypted: string, iv: string, authTag: string }
 * @returns {string} - Decrypted plain text value
 */
function decryptField(encryptedData) {
  if (!encryptedData || !encryptedData.encrypted) return null;
  
  try {
    const { encrypted, iv, authTag } = encryptedData;
    
    // Create decipher
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      ENCRYPTION_KEY,
      Buffer.from(iv, 'hex')
    );
    
    // Set authentication tag
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    // Decrypt the value
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('❌ Decryption error:', error);
    throw new Error('Failed to decrypt field');
  }
}

/**
 * Encrypt user sensitive data
 * @param {object} userData - User data object
 * @returns {object} - User data with encrypted fields
 */
function encryptUserData(userData) {
  const encrypted = { ...userData };
  
  // Encrypt email
  if (userData.email) {
    encrypted.encryptedEmail = encryptField(userData.email);
    delete encrypted.email; // Remove plain text
  }
  
  // Encrypt phone number
  if (userData.phoneNumber) {
    encrypted.encryptedPhone = encryptField(userData.phoneNumber);
    delete encrypted.phoneNumber; // Remove plain text
  }
  
  // Encrypt password (instead of hashing)
  if (userData.password) {
    encrypted.encryptedPassword = encryptField(userData.password);
    delete encrypted.password; // Remove plain text
  }
  
  // Keep username visible (not encrypted)
  // Keep name visible (or encrypt if needed)
  
  return encrypted;
}

/**
 * Decrypt user sensitive data
 * @param {object} encryptedUserData - User data with encrypted fields
 * @returns {object} - User data with decrypted fields
 */
function decryptUserData(encryptedUserData) {
  const decrypted = { ...encryptedUserData };
  
  // Decrypt email
  if (encryptedUserData.encryptedEmail) {
    decrypted.email = decryptField(encryptedUserData.encryptedEmail);
  }
  
  // Decrypt phone number
  if (encryptedUserData.encryptedPhone) {
    decrypted.phoneNumber = decryptField(encryptedUserData.encryptedPhone);
  }
  
  // Decrypt password
  if (encryptedUserData.encryptedPassword) {
    decrypted.password = decryptField(encryptedUserData.encryptedPassword);
  }
  
  return decrypted;
}

/**
 * Verify password against encrypted password
 * @param {string} plainPassword - Plain text password to verify
 * @param {object} encryptedPassword - Encrypted password object
 * @returns {boolean} - True if passwords match
 */
function verifyPassword(plainPassword, encryptedPassword) {
  try {
    const decryptedPassword = decryptField(encryptedPassword);
    return plainPassword === decryptedPassword;
  } catch (error) {
    console.error('❌ Password verification error:', error);
    return false;
  }
}

/**
 * Check if user data is already encrypted
 * @param {object} userData - User data object
 * @returns {boolean} - True if data is encrypted
 */
function isUserDataEncrypted(userData) {
  return !!(userData.encryptedEmail || userData.encryptedPhone || userData.encryptedPassword);
}

module.exports = {
  encryptField,
  decryptField,
  encryptUserData,
  decryptUserData,
  verifyPassword,
  isUserDataEncrypted,
  ENCRYPTION_KEY
};
