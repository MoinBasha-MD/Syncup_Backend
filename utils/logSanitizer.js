/**
 * Log Sanitization Service
 * 
 * Masks sensitive data in logs to prevent exposure of:
 * - Phone numbers
 * - Email addresses
 * - Full names
 * - User IDs (partial masking)
 * - Passwords
 * - Tokens
 * - API keys
 * 
 * Critical for E2EE security and GDPR compliance
 */

class LogSanitizer {
  /**
   * Mask phone number - show only last 4 digits
   * Example: +919876543210 → +91****3210
   */
  static maskPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return phone;
    
    // Handle international format (+91, +1, etc.)
    if (phone.startsWith('+')) {
      const countryCode = phone.substring(0, 3);
      const lastFour = phone.slice(-4);
      return `${countryCode}****${lastFour}`;
    }
    
    // Handle 10-digit format
    if (phone.length === 10) {
      return `******${phone.slice(-4)}`;
    }
    
    // Generic masking
    const lastFour = phone.slice(-4);
    return `****${lastFour}`;
  }

  /**
   * Mask email - show only first 2 chars and domain
   * Example: john.doe@example.com → jo****@example.com
   */
  static maskEmail(email) {
    if (!email || typeof email !== 'string' || !email.includes('@')) return email;
    
    const [localPart, domain] = email.split('@');
    const maskedLocal = localPart.length > 2 
      ? `${localPart.substring(0, 2)}****`
      : '****';
    
    return `${maskedLocal}@${domain}`;
  }

  /**
   * Mask name - show only first name initial
   * Example: John Doe → J*** D***
   */
  static maskName(name) {
    if (!name || typeof name !== 'string') return name;
    
    const parts = name.trim().split(' ');
    return parts.map(part => {
      if (part.length === 0) return '';
      return `${part[0]}${'*'.repeat(Math.min(part.length - 1, 3))}`;
    }).join(' ');
  }

  /**
   * Mask user ID - show only first 4 and last 4 chars
   * Example: 1234567890abcdef → 1234****cdef
   */
  static maskUserId(userId) {
    if (!userId || typeof userId !== 'string') return userId;
    
    if (userId.length <= 8) {
      return `${userId.substring(0, 2)}****`;
    }
    
    return `${userId.substring(0, 4)}****${userId.slice(-4)}`;
  }

  /**
   * Completely mask passwords and tokens
   */
  static maskSecret(secret) {
    return '********';
  }

  /**
   * Sanitize a user object for logging
   */
  static sanitizeUser(user) {
    if (!user) return user;
    
    return {
      userId: this.maskUserId(user.userId),
      name: this.maskName(user.name),
      phoneNumber: this.maskPhoneNumber(user.phoneNumber),
      email: this.maskEmail(user.email),
      // Keep non-sensitive fields
      isOnline: user.isOnline,
      status: user.status,
      // Never log these
      password: undefined,
      socketId: undefined,
    };
  }

  /**
   * Sanitize an array of users
   */
  static sanitizeUsers(users) {
    if (!Array.isArray(users)) return users;
    return users.map(user => this.sanitizeUser(user));
  }

  /**
   * Sanitize a friend object
   */
  static sanitizeFriend(friend) {
    if (!friend) return friend;
    
    return {
      userId: this.maskUserId(friend.userId),
      friendUserId: this.maskUserId(friend.friendUserId),
      name: this.maskName(friend.name),
      phoneNumber: this.maskPhoneNumber(friend.phoneNumber),
      email: this.maskEmail(friend.email),
      status: friend.status,
      addedAt: friend.addedAt,
    };
  }

  /**
   * Sanitize an array of friends
   */
  static sanitizeFriends(friends) {
    if (!Array.isArray(friends)) return friends;
    return friends.map(friend => this.sanitizeFriend(friend));
  }

  /**
   * Sanitize a message object
   */
  static sanitizeMessage(message) {
    if (!message) return message;
    
    return {
      messageId: message.messageId || message._id,
      senderId: this.maskUserId(message.senderId),
      recipientId: this.maskUserId(message.recipientId),
      content: message.content ? '***encrypted***' : undefined, // Never log message content
      messageType: message.messageType,
      timestamp: message.timestamp,
    };
  }

  /**
   * Sanitize request body - remove sensitive fields
   */
  static sanitizeRequestBody(body) {
    if (!body || typeof body !== 'object') return body;
    
    const sanitized = { ...body };
    
    // Remove sensitive fields
    const sensitiveFields = [
      'password', 
      'newPassword', 
      'oldPassword',
      'token',
      'refreshToken',
      'apiKey',
      'secret',
      'privateKey',
      'sessionKey',
      'contentKey',
    ];
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '********';
      }
    });
    
    // Mask PII fields
    if (sanitized.phoneNumber) {
      sanitized.phoneNumber = this.maskPhoneNumber(sanitized.phoneNumber);
    }
    if (sanitized.email) {
      sanitized.email = this.maskEmail(sanitized.email);
    }
    if (sanitized.name) {
      sanitized.name = this.maskName(sanitized.name);
    }
    
    return sanitized;
  }

  /**
   * Create a safe log message
   * Usage: console.log(LogSanitizer.safe('User logged in:', user))
   */
  static safe(message, data) {
    if (!data) return message;
    
    // Auto-detect data type and sanitize
    if (data.userId && data.name) {
      return `${message} ${JSON.stringify(this.sanitizeUser(data))}`;
    }
    
    if (Array.isArray(data) && data[0]?.userId) {
      return `${message} ${JSON.stringify(this.sanitizeUsers(data))}`;
    }
    
    if (data.senderId && data.recipientId) {
      return `${message} ${JSON.stringify(this.sanitizeMessage(data))}`;
    }
    
    // Generic object sanitization
    if (typeof data === 'object') {
      return `${message} ${JSON.stringify(this.sanitizeRequestBody(data))}`;
    }
    
    return `${message} ${data}`;
  }

  /**
   * Sanitize error logs
   */
  static sanitizeError(error, context = {}) {
    return {
      message: error.message,
      name: error.name,
      code: error.code,
      // Sanitize context
      context: this.sanitizeRequestBody(context),
      // Never log full stack in production
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
    };
  }
}

module.exports = LogSanitizer;
