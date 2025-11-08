/**
 * Encrypted Logging Examples
 * Demonstrates how to replace console.log with encrypted logging
 */

const { 
  logServerSafe, 
  logConnectionSafe, 
  logAISafe,
  logEncryption 
} = require('../utils/loggerSetup');

// ============================================================================
// EXAMPLE 1: User Authentication
// ============================================================================

// ❌ OLD WAY (Exposes PII in logs)
function loginOld(user) {
  console.log(`User logged in: ${user.name} (${user.phoneNumber})`);
  console.log(`Email: ${user.email}`);
}

// ✅ NEW WAY (Encrypted/Masked PII)
function loginNew(user) {
  logServerSafe('info', 'User logged in', {
    name: user.name,
    phoneNumber: user.phoneNumber,
    email: user.email,
    userId: user.userId
  }, 'mask'); // Output: J*** D*** (+******7890)
}

// ============================================================================
// EXAMPLE 2: Socket Connection
// ============================================================================

// ❌ OLD WAY
function socketConnectionOld(socket, user) {
  console.log(`🔗 User connected: ${user.name} (userId: ${user.userId})`);
  console.log(`Phone: ${user.phoneNumber}`);
}

// ✅ NEW WAY
function socketConnectionNew(socket, user) {
  logConnectionSafe('info', 'User connected', {
    name: user.name,
    userId: user.userId,
    phoneNumber: user.phoneNumber,
    socketId: socket.id
  }, 'mask');
}

// ============================================================================
// EXAMPLE 3: Error Logging with Sensitive Data
// ============================================================================

// ❌ OLD WAY
function errorOld(error, user) {
  console.log(`❌ Error for user ${user.name} (${user.phoneNumber}):`, error.message);
}

// ✅ NEW WAY
function errorNew(error, user) {
  logServerSafe('error', 'Operation failed', {
    error: error.message,
    stack: error.stack,
    userName: user.name,
    userPhone: user.phoneNumber,
    userId: user.userId
  }, 'hash'); // Use hash for error tracking without exposing full PII
}

// ============================================================================
// EXAMPLE 4: Database Query Logging
// ============================================================================

// ❌ OLD WAY
function dbQueryOld(phoneNumber) {
  console.log(`Looking up user by phone number: ${phoneNumber}`);
}

// ✅ NEW WAY
function dbQueryNew(phoneNumber) {
  logServerSafe('info', 'Database query', {
    operation: 'findUserByPhone',
    phoneNumber: phoneNumber
  }, 'mask');
}

// ============================================================================
// EXAMPLE 5: Password Reset
// ============================================================================

// ❌ OLD WAY
function passwordResetOld(user, newPassword) {
  console.log(`Password updated for user: ${user.name}`);
  console.log(`Email: ${user.email}, Phone: ${user.phoneNumber}`);
}

// ✅ NEW WAY
function passwordResetNew(user) {
  logServerSafe('info', 'Password reset successful', {
    userId: user.userId,
    name: user.name,
    email: user.email,
    phoneNumber: user.phoneNumber
  }, 'encrypt'); // Full encryption for sensitive operations
}

// ============================================================================
// EXAMPLE 6: Batch Processing with Multiple Users
// ============================================================================

// ❌ OLD WAY
function batchProcessOld(users) {
  console.log('Processing users:', users.map(u => `${u.name} (${u.phoneNumber})`).join(', '));
}

// ✅ NEW WAY
function batchProcessNew(users) {
  // Process the array of users
  const processedUsers = logEncryption.processObject(users, 'mask');
  logServerSafe('info', 'Batch processing users', {
    count: users.length,
    users: processedUsers
  }, 'mask');
}

// ============================================================================
// EXAMPLE 7: AI Message with User Context
// ============================================================================

// ❌ OLD WAY
function aiMessageOld(user, message) {
  console.log(`🤖 AI message for ${user.name} (${user.phoneNumber}): ${message}`);
}

// ✅ NEW WAY
function aiMessageNew(user, message) {
  logAISafe('info', 'AI message sent', {
    userName: user.name,
    userPhone: user.phoneNumber,
    userId: user.userId,
    messagePreview: message.substring(0, 50)
  }, 'mask');
}

// ============================================================================
// EXAMPLE 8: Manual Encryption/Decryption
// ============================================================================

function manualEncryptionExample() {
  const sensitiveData = {
    name: 'John Doe',
    phoneNumber: '+1234567890',
    email: 'john@example.com',
    creditCard: '4111-1111-1111-1111'
  };

  // Encrypt entire object
  const encrypted = logEncryption.processObject(sensitiveData, 'encrypt');
  console.log('Encrypted:', encrypted);
  // Output: { name: 'ENC[...]', phoneNumber: 'ENC[...]', ... }

  // Mask for display
  const masked = logEncryption.processObject(sensitiveData, 'mask');
  console.log('Masked:', masked);
  // Output: { name: 'J*** D***', phoneNumber: '+******7890', ... }

  // Hash for tracking
  const hashed = logEncryption.processObject(sensitiveData, 'hash');
  console.log('Hashed:', hashed);
  // Output: { name: 'HASH[a1b2c3...]', phoneNumber: 'HASH[x7y8z9...]', ... }

  // Decrypt single value
  const encryptedPhone = logEncryption.encrypt('+1234567890');
  const decryptedPhone = logEncryption.decrypt(encryptedPhone);
  console.log('Original:', '+1234567890');
  console.log('Encrypted:', encryptedPhone);
  console.log('Decrypted:', decryptedPhone);
}

// ============================================================================
// EXAMPLE 9: Conditional Logging Based on Environment
// ============================================================================

function conditionalLogging(user) {
  if (process.env.NODE_ENV === 'development') {
    // In development, use masking for easier debugging
    logServerSafe('info', 'User action', {
      name: user.name,
      phoneNumber: user.phoneNumber
    }, 'mask');
  } else {
    // In production, use full encryption
    logServerSafe('info', 'User action', {
      name: user.name,
      phoneNumber: user.phoneNumber
    }, 'encrypt');
  }
}

// ============================================================================
// EXAMPLE 10: Audit Trail with Hashing
// ============================================================================

function auditTrail(action, user, details) {
  // Use hashing for audit trails - allows tracking without exposing PII
  logServerSafe('info', `Audit: ${action}`, {
    action,
    userId: user.userId,
    userName: user.name,
    userPhone: user.phoneNumber,
    timestamp: new Date().toISOString(),
    details
  }, 'hash');
  
  // This creates a consistent hash for the same user
  // allowing you to track actions without storing actual PII
}

// ============================================================================
// MIGRATION GUIDE
// ============================================================================

/*
STEP 1: Import the logging utilities
const { logServerSafe, logConnectionSafe, logAISafe } = require('../utils/loggerSetup');

STEP 2: Find all console.log statements with user data
Use grep or search: console.log.*name|console.log.*phone|console.log.*email

STEP 3: Replace with appropriate safe logging
- Use 'mask' for general logging (default)
- Use 'encrypt' for sensitive operations
- Use 'hash' for audit trails and tracking

STEP 4: Choose the right logger
- logServerSafe - General server operations
- logConnectionSafe - Socket/connection events
- logAISafe - AI-related operations
- logDBSafe - Database operations

STEP 5: Test
- Check logs to ensure PII is masked/encrypted
- Verify functionality still works
- Monitor performance impact (minimal)
*/

// ============================================================================
// REAL CONTROLLER EXAMPLE
// ============================================================================

// Before:
const userControllerOld = {
  async getUserData(req, res) {
    const { phoneNumber } = req.params;
    console.log(`Getting user data for phone: ${phoneNumber}`);
    
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      console.log(`No user found with phone number: ${phoneNumber}`);
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log(`Found user: ${user.name}, email: ${user.email}`);
    res.json({ user });
  }
};

// After:
const userControllerNew = {
  async getUserData(req, res) {
    const { phoneNumber } = req.params;
    
    logServerSafe('info', 'Fetching user data', {
      phoneNumber,
      requestIp: req.ip
    }, 'mask');
    
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      logServerSafe('warn', 'User not found', {
        phoneNumber
      }, 'mask');
      return res.status(404).json({ message: 'User not found' });
    }
    
    logServerSafe('info', 'User data retrieved', {
      userId: user.userId,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber
    }, 'mask');
    
    res.json({ user });
  }
};

// ============================================================================
// Export examples for testing
// ============================================================================

module.exports = {
  loginNew,
  socketConnectionNew,
  errorNew,
  dbQueryNew,
  passwordResetNew,
  batchProcessNew,
  aiMessageNew,
  manualEncryptionExample,
  conditionalLogging,
  auditTrail,
  userControllerNew
};
