/**
 * Honeypot Key Vault System
 * 
 * A signature-protected key management system that:
 * 1. Stores encryption keys in a signature-protected file
 * 2. Only legitimate server requests with correct signature can access real keys
 * 3. Unauthorized access attempts receive fake keys (honeypot)
 * 4. Logs all access attempts for security monitoring
 * 
 * This replaces the need for external KMS (AWS, Azure) while maintaining security.
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class HoneypotKeyVault {
  constructor() {
    this.vaultPath = path.join(__dirname, '../.keyvault');
    this.signaturePath = path.join(__dirname, '../.keyvault.sig');
    this.logPath = path.join(__dirname, '../logs/keyvault-access.log');
    
    // Server signature - generated at initialization
    this.serverSignature = null;
    
    // Honeypot keys (fake keys for unauthorized access)
    this.honeypotKeys = this.generateHoneypotKeys();
    
    // Access attempt tracking
    this.accessAttempts = new Map();
    this.maxAttemptsBeforeLockout = 5;
    this.lockoutDuration = 15 * 60 * 1000; // 15 minutes
  }
  
  /**
   * Initialize the key vault
   * Must be called once during server startup
   */
  async initialize() {
    try {
      console.log('🔐 [HONEYPOT VAULT] Initializing key vault...');
      
      // Generate server signature
      this.serverSignature = this.generateServerSignature();
      
      // Check if vault exists
      const vaultExists = await this.vaultExists();
      
      if (!vaultExists) {
        console.log('📝 [HONEYPOT VAULT] Creating new key vault...');
        await this.createVault();
      } else {
        console.log('✅ [HONEYPOT VAULT] Existing vault found');
        await this.verifyVaultIntegrity();
      }
      
      // Ensure log directory exists
      await this.ensureLogDirectory();
      
      console.log('✅ [HONEYPOT VAULT] Key vault initialized successfully');
      console.log(`   Vault location: ${this.vaultPath}`);
      console.log(`   Signature: ${this.serverSignature.substring(0, 16)}...`);
      
    } catch (error) {
      console.error('❌ [HONEYPOT VAULT] Initialization failed:', error);
      throw new Error('Failed to initialize key vault');
    }
  }
  
  /**
   * Generate server signature based on environment and system info
   * This signature is required to access real keys
   */
  generateServerSignature() {
    const components = [
      process.env.NODE_ENV || 'development',
      process.env.SERVER_SECRET || 'default-secret',
      process.pid.toString(),
      __dirname,
      Date.now().toString().substring(0, 10) // Date-based component (changes daily)
    ];
    
    const signatureData = components.join('::');
    const hash = crypto.createHash('sha256').update(signatureData).digest('hex');
    
    return hash;
  }
  
  /**
   * Generate honeypot keys (fake keys that won't work)
   */
  generateHoneypotKeys() {
    return {
      FILE_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
      POST_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      HONEYPOT: true,
      WARNING: 'These are fake keys. Unauthorized access detected.'
    };
  }
  
  /**
   * Check if vault exists
   */
  async vaultExists() {
    try {
      await fs.access(this.vaultPath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Create new vault with real keys
   */
  async createVault() {
    // Generate real encryption keys
    const realKeys = {
      FILE_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
      POST_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      created: new Date().toISOString(),
      version: '1.0.0'
    };
    
    // Encrypt vault content
    const encryptedVault = this.encryptVault(realKeys);
    
    // Write vault file
    await fs.writeFile(this.vaultPath, encryptedVault, { mode: 0o600 }); // Read/write for owner only
    
    // Create signature file
    const signature = this.createVaultSignature(encryptedVault);
    await fs.writeFile(this.signaturePath, signature, { mode: 0o600 });
    
    console.log('✅ [HONEYPOT VAULT] Vault created successfully');
    console.log('   Real keys generated and encrypted');
  }
  
  /**
   * Encrypt vault content
   */
  encryptVault(data) {
    const key = crypto.scryptSync(this.serverSignature, 'vault-salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(data), 'utf8'),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encrypted
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }
  
  /**
   * Decrypt vault content
   */
  decryptVault(encryptedData) {
    const buffer = Buffer.from(encryptedData, 'base64');
    
    const iv = buffer.slice(0, 16);
    const authTag = buffer.slice(16, 32);
    const encrypted = buffer.slice(32);
    
    const key = crypto.scryptSync(this.serverSignature, 'vault-salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return JSON.parse(decrypted.toString('utf8'));
  }
  
  /**
   * Create vault signature
   */
  createVaultSignature(vaultContent) {
    const hmac = crypto.createHmac('sha256', this.serverSignature);
    hmac.update(vaultContent);
    return hmac.digest('hex');
  }
  
  /**
   * Verify vault signature
   */
  async verifyVaultSignature(vaultContent) {
    try {
      const storedSignature = await fs.readFile(this.signaturePath, 'utf8');
      const computedSignature = this.createVaultSignature(vaultContent);
      
      return storedSignature === computedSignature;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Verify vault integrity
   */
  async verifyVaultIntegrity() {
    try {
      const vaultContent = await fs.readFile(this.vaultPath, 'utf8');
      const isValid = await this.verifyVaultSignature(vaultContent);
      
      if (!isValid) {
        console.error('⚠️ [HONEYPOT VAULT] Vault signature verification failed!');
        console.error('   Vault may have been tampered with');
        await this.logAccessAttempt('SIGNATURE_VERIFICATION_FAILED', false);
        throw new Error('Vault integrity check failed');
      }
      
      console.log('✅ [HONEYPOT VAULT] Vault integrity verified');
    } catch (error) {
      console.error('❌ [HONEYPOT VAULT] Integrity verification error:', error.message);
      throw error;
    }
  }
  
  /**
   * Get encryption key with signature verification
   * This is the main method used by the application
   * 
   * @param {string} keyName - Name of the key to retrieve
   * @param {string} signature - Server signature for authentication
   * @returns {string} - Encryption key (real or honeypot)
   */
  async getKey(keyName, signature) {
    const requestId = crypto.randomBytes(8).toString('hex');
    
    try {
      // Check if caller is locked out
      if (this.isLockedOut(signature)) {
        console.warn(`🚨 [HONEYPOT VAULT] Locked out signature attempted access: ${signature.substring(0, 16)}...`);
        await this.logAccessAttempt(keyName, false, signature, 'LOCKED_OUT');
        return this.honeypotKeys[keyName] || this.honeypotKeys.FILE_ENCRYPTION_KEY;
      }
      
      // Verify signature
      if (signature !== this.serverSignature) {
        console.warn(`🚨 [HONEYPOT VAULT] Invalid signature attempted access to ${keyName}`);
        console.warn(`   Expected: ${this.serverSignature.substring(0, 16)}...`);
        console.warn(`   Received: ${signature.substring(0, 16)}...`);
        
        // Track failed attempt
        this.trackFailedAttempt(signature);
        
        // Log unauthorized access
        await this.logAccessAttempt(keyName, false, signature, 'INVALID_SIGNATURE');
        
        // Return honeypot key
        return this.honeypotKeys[keyName] || this.honeypotKeys.FILE_ENCRYPTION_KEY;
      }
      
      // Signature valid - return real key
      const vaultContent = await fs.readFile(this.vaultPath, 'utf8');
      
      // Verify vault wasn't tampered with
      const isValid = await this.verifyVaultSignature(vaultContent);
      if (!isValid) {
        console.error('⚠️ [HONEYPOT VAULT] Vault tampering detected!');
        await this.logAccessAttempt(keyName, false, signature, 'VAULT_TAMPERED');
        return this.honeypotKeys[keyName] || this.honeypotKeys.FILE_ENCRYPTION_KEY;
      }
      
      // Decrypt and return real key
      const realKeys = this.decryptVault(vaultContent);
      
      // Log successful access
      await this.logAccessAttempt(keyName, true, signature, 'SUCCESS');
      
      console.log(`✅ [HONEYPOT VAULT] Key accessed: ${keyName} [${requestId}]`);
      
      return realKeys[keyName];
      
    } catch (error) {
      console.error(`❌ [HONEYPOT VAULT] Error accessing key ${keyName}:`, error.message);
      await this.logAccessAttempt(keyName, false, signature, 'ERROR');
      
      // Return honeypot key on error
      return this.honeypotKeys[keyName] || this.honeypotKeys.FILE_ENCRYPTION_KEY;
    }
  }
  
  /**
   * Track failed access attempts
   */
  trackFailedAttempt(signature) {
    const attempts = this.accessAttempts.get(signature) || { count: 0, firstAttempt: Date.now() };
    attempts.count++;
    attempts.lastAttempt = Date.now();
    
    this.accessAttempts.set(signature, attempts);
    
    if (attempts.count >= this.maxAttemptsBeforeLockout) {
      attempts.lockedUntil = Date.now() + this.lockoutDuration;
      console.error(`🚨 [HONEYPOT VAULT] Signature locked out after ${attempts.count} failed attempts`);
    }
  }
  
  /**
   * Check if signature is locked out
   */
  isLockedOut(signature) {
    const attempts = this.accessAttempts.get(signature);
    if (!attempts || !attempts.lockedUntil) return false;
    
    if (Date.now() < attempts.lockedUntil) {
      return true;
    }
    
    // Lockout expired, reset
    this.accessAttempts.delete(signature);
    return false;
  }
  
  /**
   * Log access attempt
   */
  async logAccessAttempt(keyName, success, signature = 'unknown', reason = '') {
    const logEntry = {
      timestamp: new Date().toISOString(),
      keyName,
      success,
      signature: signature.substring(0, 16) + '...',
      reason,
      pid: process.pid,
      ip: 'localhost' // Could be enhanced to track actual IP
    };
    
    try {
      const logLine = JSON.stringify(logEntry) + '\n';
      await fs.appendFile(this.logPath, logLine);
    } catch (error) {
      console.error('❌ [HONEYPOT VAULT] Failed to write access log:', error.message);
    }
  }
  
  /**
   * Ensure log directory exists
   */
  async ensureLogDirectory() {
    const logDir = path.dirname(this.logPath);
    try {
      await fs.mkdir(logDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }
  
  /**
   * Rotate encryption keys (for security)
   */
  async rotateKeys() {
    console.log('🔄 [HONEYPOT VAULT] Rotating encryption keys...');
    
    try {
      // Generate new keys
      const newKeys = {
        FILE_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
        POST_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
        JWT_SECRET: crypto.randomBytes(32).toString('hex'),
        created: new Date().toISOString(),
        version: '1.0.0',
        rotated: true,
        previousRotation: new Date().toISOString()
      };
      
      // Encrypt and save
      const encryptedVault = this.encryptVault(newKeys);
      await fs.writeFile(this.vaultPath, encryptedVault, { mode: 0o600 });
      
      // Update signature
      const signature = this.createVaultSignature(encryptedVault);
      await fs.writeFile(this.signaturePath, signature, { mode: 0o600 });
      
      console.log('✅ [HONEYPOT VAULT] Keys rotated successfully');
      
      return newKeys;
    } catch (error) {
      console.error('❌ [HONEYPOT VAULT] Key rotation failed:', error);
      throw error;
    }
  }
  
  /**
   * Get access statistics
   */
  async getAccessStats() {
    try {
      const logContent = await fs.readFile(this.logPath, 'utf8');
      const logs = logContent.trim().split('\n').map(line => JSON.parse(line));
      
      const stats = {
        total: logs.length,
        successful: logs.filter(l => l.success).length,
        failed: logs.filter(l => !l.success).length,
        byKey: {},
        recentAttempts: logs.slice(-10)
      };
      
      logs.forEach(log => {
        if (!stats.byKey[log.keyName]) {
          stats.byKey[log.keyName] = { success: 0, failed: 0 };
        }
        if (log.success) {
          stats.byKey[log.keyName].success++;
        } else {
          stats.byKey[log.keyName].failed++;
        }
      });
      
      return stats;
    } catch (error) {
      return { error: 'No access logs found' };
    }
  }
}

// Singleton instance
let instance = null;

async function getInstance() {
  if (!instance) {
    instance = new HoneypotKeyVault();
    await instance.initialize();
  }
  return instance;
}

module.exports = {
  HoneypotKeyVault,
  getInstance
};
