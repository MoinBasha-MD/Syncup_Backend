const crypto = require('crypto');

/**
 * Log Encryption Utility
 * Encrypts sensitive user data (names, phone numbers, emails) in logs
 * Uses AES-256-CBC encryption with environment-based key
 */

class LogEncryption {
  constructor() {
    // Use environment variable or generate a secure key
    this.encryptionKey = process.env.LOG_ENCRYPTION_KEY || crypto.randomBytes(32);
    this.algorithm = 'aes-256-cbc';
    
    // Fields that should be encrypted in logs
    this.sensitiveFields = [
      'name', 'userName', 'phoneNumber', 'phone', 'mobile', 
      'email', 'address', 'deviceToken', 'password', 'pin',
      'encryptionKey', 'token', 'otp', 'ssn', 'creditCard'
    ];
  }

  /**
   * Encrypt a single value
   * @param {string} value - Value to encrypt
   * @returns {string} - Encrypted value with format: ENC[hash]
   */
  encrypt(value) {
    if (!value || typeof value !== 'string') return value;
    
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);
      
      let encrypted = cipher.update(value, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Return in a recognizable format with IV prepended
      return `ENC[${iv.toString('hex')}:${encrypted}]`;
    } catch (error) {
      return `ENC[ERROR]`;
    }
  }

  /**
   * Decrypt a value (for authorized viewing)
   * @param {string} encryptedValue - Encrypted value with format: ENC[iv:data]
   * @returns {string} - Decrypted value
   */
  decrypt(encryptedValue) {
    if (!encryptedValue || !encryptedValue.startsWith('ENC[')) {
      return encryptedValue;
    }
    
    try {
      // Extract IV and encrypted data
      const match = encryptedValue.match(/ENC\[([^:]+):([^\]]+)\]/);
      if (!match) return encryptedValue;
      
      const iv = Buffer.from(match[1], 'hex');
      const encrypted = match[2];
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      return 'DECRYPT_ERROR';
    }
  }

  /**
   * Hash sensitive data (one-way, for identification without exposure)
   * @param {string} value - Value to hash
   * @returns {string} - Hashed value with format: HASH[hash]
   */
  hash(value) {
    if (!value || typeof value !== 'string') return value;
    
    try {
      const hash = crypto.createHash('sha256').update(value).digest('hex').substring(0, 12);
      return `HASH[${hash}]`;
    } catch (error) {
      return 'HASH[ERROR]';
    }
  }

  /**
   * Mask sensitive data (partial visibility)
   * @param {string} value - Value to mask
   * @param {string} type - Type of data (phone, email, name)
   * @returns {string} - Masked value
   */
  mask(value, type = 'default') {
    if (!value || typeof value !== 'string') return value;
    
    try {
      switch (type) {
        case 'phone':
          // Show last 4 digits: +1234567890 -> +******7890
          return value.length > 4 
            ? value.substring(0, 2) + '*'.repeat(value.length - 6) + value.substring(value.length - 4)
            : '****';
        
        case 'email':
          // Show first char and domain: user@example.com -> u***@example.com
          const [local, domain] = value.split('@');
          return local ? `${local[0]}***@${domain || '***'}` : '***@***';
        
        case 'name':
          // Show first and last initial: John Doe -> J*** D***
          const parts = value.split(' ');
          return parts.map(part => part[0] + '***').join(' ');
        
        default:
          // Show first 2 and last 2 chars
          return value.length > 4 
            ? value.substring(0, 2) + '*'.repeat(value.length - 4) + value.substring(value.length - 2)
            : '****';
      }
    } catch (error) {
      return '****';
    }
  }

  /**
   * Process an object and encrypt/mask sensitive fields
   * @param {Object} obj - Object to process
   * @param {string} mode - 'encrypt', 'mask', or 'hash'
   * @returns {Object} - Processed object
   */
  processObject(obj, mode = 'mask') {
    if (!obj || typeof obj !== 'object') return obj;
    
    const processed = Array.isArray(obj) ? [] : {};
    
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = this.sensitiveFields.some(field => 
        lowerKey.includes(field.toLowerCase())
      );
      
      if (isSensitive && typeof value === 'string') {
        // Determine type for masking
        let type = 'default';
        if (lowerKey.includes('phone') || lowerKey.includes('mobile')) type = 'phone';
        else if (lowerKey.includes('email')) type = 'email';
        else if (lowerKey.includes('name')) type = 'name';
        
        // Apply processing based on mode
        switch (mode) {
          case 'encrypt':
            processed[key] = this.encrypt(value);
            break;
          case 'hash':
            processed[key] = this.hash(value);
            break;
          case 'mask':
          default:
            processed[key] = this.mask(value, type);
            break;
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively process nested objects
        processed[key] = this.processObject(value, mode);
      } else {
        processed[key] = value;
      }
    }
    
    return processed;
  }

  /**
   * Create a safe log message with encrypted/masked sensitive data
   * @param {string} message - Log message
   * @param {Object} data - Data object to log
   * @param {string} mode - 'encrypt', 'mask', or 'hash'
   * @returns {Object} - Safe log object
   */
  createSafeLog(message, data = {}, mode = 'mask') {
    return {
      message,
      data: this.processObject(data, mode),
      timestamp: new Date().toISOString(),
      mode
    };
  }
}

// Singleton instance
const logEncryption = new LogEncryption();

module.exports = logEncryption;
