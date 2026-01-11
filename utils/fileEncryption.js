const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { getInstance: getKeyVault } = require('./honeypotKeyVault');

/**
 * Server-Side File Encryption Utility
 * 
 * Encrypts files at rest on the server using AES-256-GCM.
 * This is DIFFERENT from E2EE - this protects files on the server.
 * 
 * E2EE (Frontend): Protects data in transit between users
 * Server Encryption (Backend): Protects data at rest on server
 */

class FileEncryption {
  constructor() {
    // Master encryption key - Retrieved from honeypot key vault
    this.masterKey = null; // Will be loaded from vault
    this.keyVault = null;
    this.algorithm = 'aes-256-gcm';
    this.ivLength = 16; // 128 bits
    this.authTagLength = 16; // 128 bits
    this.saltLength = 32; // 256 bits
    this.serverSignature = this.generateServerSignature();
  }

  /**
   * Generate server signature for vault access
   */
  generateServerSignature() {
    const components = [
      process.env.NODE_ENV || 'development',
      process.env.SERVER_SECRET || 'default-secret',
      process.pid.toString(),
      __dirname,
      Date.now().toString().substring(0, 10)
    ];
    
    const signatureData = components.join('::');
    return crypto.createHash('sha256').update(signatureData).digest('hex');
  }
  
  /**
   * Get master encryption key from honeypot vault
   */
  async getMasterKey() {
    if (this.masterKey) {
      return this.masterKey;
    }
    
    try {
      if (!this.keyVault) {
        this.keyVault = await getKeyVault();
      }
      
      const keyHex = await this.keyVault.getKey('FILE_ENCRYPTION_KEY', this.serverSignature);
      this.masterKey = Buffer.from(keyHex, 'hex');
      
      console.log('✅ [FILE ENCRYPTION] Master key loaded from vault');
      return this.masterKey;
    } catch (error) {
      console.error('❌ [FILE ENCRYPTION] Failed to load key from vault:', error);
      throw new Error('Failed to initialize file encryption');
    }
  }

  /**
   * Derive encryption key from master key using PBKDF2
   * This allows key rotation without re-encrypting all files
   */
  async deriveKey(salt) {
    const masterKey = await this.getMasterKey();
    return crypto.pbkdf2Sync(
      masterKey, salt, 100000, 32, 'sha256');
  }

  /**
   * Encrypt a file
   * 
   * @param {string} inputPath - Path to plaintext file
   * @param {string} outputPath - Path to save encrypted file
   * @returns {Promise<Object>} Encryption metadata
   */
  async encryptFile(inputPath, outputPath) {
    try {
      console.log('🔐 [FILE ENCRYPTION] Encrypting file:', path.basename(inputPath));
      
      // Read file
      const plaintext = await fs.readFile(inputPath);
      
      // Generate salt and derive key
      const salt = crypto.randomBytes(this.saltLength);
      const key = this.deriveKey(salt);
      
      // Generate IV
      const iv = crypto.randomBytes(this.ivLength);
      
      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);
      
      // Encrypt
      const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final()
      ]);
      
      // Get auth tag
      const authTag = cipher.getAuthTag();
      
      // Create encrypted file structure:
      // [salt (32 bytes)][iv (16 bytes)][authTag (16 bytes)][encrypted data]
      const encryptedFile = Buffer.concat([
        salt,
        iv,
        authTag,
        encrypted
      ]);
      
      // Write encrypted file
      await fs.writeFile(outputPath, encryptedFile);
      
      console.log('✅ [FILE ENCRYPTION] File encrypted successfully');
      
      return {
        success: true,
        originalSize: plaintext.length,
        encryptedSize: encryptedFile.length,
        algorithm: this.algorithm
      };
    } catch (error) {
      console.error('❌ [FILE ENCRYPTION] Encryption failed:', error);
      throw error;
    }
  }

  /**
   * Decrypt a file
   * 
   * @param {string} inputPath - Path to encrypted file
   * @param {string} outputPath - Path to save decrypted file (optional)
   * @returns {Promise<Buffer>} Decrypted file buffer
   */
  async decryptFile(inputPath, outputPath = null) {
    try {
      console.log('🔓 [FILE ENCRYPTION] Decrypting file:', path.basename(inputPath));
      
      // Read encrypted file
      const encryptedFile = await fs.readFile(inputPath);
      
      // Extract components
      const salt = encryptedFile.slice(0, this.saltLength);
      const iv = encryptedFile.slice(this.saltLength, this.saltLength + this.ivLength);
      const authTag = encryptedFile.slice(
        this.saltLength + this.ivLength,
        this.saltLength + this.ivLength + this.authTagLength
      );
      const encrypted = encryptedFile.slice(
        this.saltLength + this.ivLength + this.authTagLength
      );
      
      // Derive key
      const key = this.deriveKey(salt);
      
      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);
      
      // Decrypt
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);
      
      // Write to output if specified
      if (outputPath) {
        await fs.writeFile(outputPath, decrypted);
      }
      
      console.log('✅ [FILE ENCRYPTION] File decrypted successfully');
      
      return decrypted;
    } catch (error) {
      console.error('❌ [FILE ENCRYPTION] Decryption failed:', error);
      throw error;
    }
  }

  /**
   * Encrypt file in place (replaces original with encrypted version)
   * 
   * @param {string} filePath - Path to file
   * @returns {Promise<Object>} Encryption metadata
   */
  async encryptInPlace(filePath) {
    const tempPath = `${filePath}.encrypting`;
    
    try {
      // Encrypt to temp file
      const result = await this.encryptFile(filePath, tempPath);
      
      // Replace original with encrypted
      await fs.unlink(filePath);
      await fs.rename(tempPath, filePath);
      
      return result;
    } catch (error) {
      // Cleanup temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Decrypt file in place (replaces encrypted with decrypted version)
   * 
   * @param {string} filePath - Path to encrypted file
   * @returns {Promise<Buffer>} Decrypted file buffer
   */
  async decryptInPlace(filePath) {
    const tempPath = `${filePath}.decrypting`;
    
    try {
      // Decrypt to temp file
      const decrypted = await this.decryptFile(filePath, tempPath);
      
      // Replace encrypted with decrypted
      await fs.unlink(filePath);
      await fs.rename(tempPath, filePath);
      
      return decrypted;
    } catch (error) {
      // Cleanup temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Check if a file is encrypted
   * 
   * @param {string} filePath - Path to file
   * @returns {Promise<boolean>} True if encrypted
   */
  async isEncrypted(filePath) {
    try {
      const fileBuffer = await fs.readFile(filePath);
      
      // Check if file has minimum size for encrypted structure
      const minSize = this.saltLength + this.ivLength + this.authTagLength;
      if (fileBuffer.length < minSize) {
        return false;
      }
      
      // Try to decrypt - if it fails, it's not encrypted (or corrupted)
      try {
        await this.decryptFile(filePath);
        return true;
      } catch (decryptError) {
        return false;
      }
    } catch (error) {
      console.error('❌ [FILE ENCRYPTION] Error checking encryption status:', error);
      return false;
    }
  }

  /**
   * Generate a secure master key (for initial setup)
   * Run this once and store in environment variable
   * 
   * @returns {string} Hex-encoded master key
   */
  static generateMasterKey() {
    const key = crypto.randomBytes(32); // 256 bits
    return key.toString('hex');
  }
}

// Singleton instance
let instance = null;

module.exports = {
  getInstance: () => {
    if (!instance) {
      instance = new FileEncryption();
    }
    return instance;
  },
  generateMasterKey: FileEncryption.generateMasterKey
};
