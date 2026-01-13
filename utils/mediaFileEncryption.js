const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getInstance: getKeyVault } = require('./honeypotKeyVault');

/**
 * Media File Encryption Utility
 * 
 * Server-side encryption for media files (posts, stories, profiles, etc.)
 * Encrypts files at rest on disk using AES-256-GCM
 * Files are decrypted on-the-fly when served to users
 * 
 * This is different from E2EE chat files - server has decryption capability
 * for performance and to support public/shared content.
 */
class MediaFileEncryption {
  constructor() {
    this.masterKey = null;
    this.keyVault = null;
    this.algorithm = 'aes-256-gcm';
    this.ivLength = 16; // 128 bits
    this.authTagLength = 16; // 128 bits
    this.chunkSize = 64 * 1024; // 64KB chunks for streaming
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

      const keyHex = await this.keyVault.getKey('MEDIA_ENCRYPTION_KEY', this.serverSignature);
      this.masterKey = Buffer.from(keyHex, 'hex');

      console.log('✅ [MEDIA ENCRYPTION] Master key loaded from vault');
      return this.masterKey;
    } catch (error) {
      console.error('❌ [MEDIA ENCRYPTION] Failed to load key from vault:', error);
      throw new Error('Failed to initialize media encryption');
    }
  }

  /**
   * Encrypt a file and save to disk
   * 
   * @param {string} inputPath - Path to original file
   * @param {string} outputPath - Path to save encrypted file (optional, defaults to inputPath + '.enc')
   * @returns {Object} - Encryption metadata { encryptedPath, iv, authTag, originalSize, mimeType }
   */
  async encryptFile(inputPath, outputPath = null) {
    try {
      console.log('🔐 [MEDIA ENCRYPTION] Encrypting file:', inputPath);

      // Validate input file exists
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
      }

      // Get file stats
      const stats = fs.statSync(inputPath);
      const originalSize = stats.size;

      // Determine output path
      const encryptedPath = outputPath || `${inputPath}.enc`;

      // Generate random IV
      const iv = crypto.randomBytes(this.ivLength);

      // Get master key
      const masterKey = await this.getMasterKey();

      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, masterKey, iv);

      // Create read and write streams
      const readStream = fs.createReadStream(inputPath);
      const writeStream = fs.createWriteStream(encryptedPath);

      // Encrypt file in chunks
      await new Promise((resolve, reject) => {
        readStream.on('data', (chunk) => {
          const encrypted = cipher.update(chunk);
          writeStream.write(encrypted);
        });

        readStream.on('end', () => {
          try {
            const final = cipher.final();
            writeStream.write(final);
            writeStream.end();
            resolve();
          } catch (error) {
            reject(error);
          }
        });

        readStream.on('error', reject);
        writeStream.on('error', reject);
      });

      // Get auth tag
      const authTag = cipher.getAuthTag();

      // Delete original file
      fs.unlinkSync(inputPath);

      console.log('✅ [MEDIA ENCRYPTION] File encrypted successfully');
      console.log('   Original size:', originalSize, 'bytes');
      console.log('   Encrypted path:', encryptedPath);

      return {
        encryptedPath,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        originalSize,
        encrypted: true
      };

    } catch (error) {
      console.error('❌ [MEDIA ENCRYPTION] Encryption failed:', error);
      throw error;
    }
  }

  /**
   * Decrypt a file and return as buffer
   * 
   * @param {string} encryptedPath - Path to encrypted file
   * @param {string} ivBase64 - IV in base64
   * @param {string} authTagBase64 - Auth tag in base64
   * @returns {Buffer} - Decrypted file data
   */
  async decryptFile(encryptedPath, ivBase64, authTagBase64) {
    try {
      console.log('🔓 [MEDIA ENCRYPTION] Decrypting file:', encryptedPath);

      // Validate encrypted file exists
      if (!fs.existsSync(encryptedPath)) {
        throw new Error(`Encrypted file not found: ${encryptedPath}`);
      }

      // Decode IV and auth tag
      const iv = Buffer.from(ivBase64, 'base64');
      const authTag = Buffer.from(authTagBase64, 'base64');

      // Get master key
      const masterKey = await this.getMasterKey();

      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, masterKey, iv);
      decipher.setAuthTag(authTag);

      // Read encrypted file
      const encryptedData = fs.readFileSync(encryptedPath);

      // Decrypt
      const decrypted = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final()
      ]);

      console.log('✅ [MEDIA ENCRYPTION] File decrypted successfully');
      console.log('   Decrypted size:', decrypted.length, 'bytes');

      return decrypted;

    } catch (error) {
      console.error('❌ [MEDIA ENCRYPTION] Decryption failed:', error);
      throw error;
    }
  }

  /**
   * Decrypt file and stream to response
   * 
   * @param {string} encryptedPath - Path to encrypted file
   * @param {string} ivBase64 - IV in base64
   * @param {string} authTagBase64 - Auth tag in base64
   * @param {Object} res - Express response object
   * @param {string} mimeType - MIME type for response header
   */
  async decryptFileStream(encryptedPath, ivBase64, authTagBase64, res, mimeType = 'application/octet-stream') {
    try {
      console.log('🔓 [MEDIA ENCRYPTION] Streaming decrypted file:', encryptedPath);

      // Validate encrypted file exists
      if (!fs.existsSync(encryptedPath)) {
        throw new Error(`Encrypted file not found: ${encryptedPath}`);
      }

      // Decode IV and auth tag
      const iv = Buffer.from(ivBase64, 'base64');
      const authTag = Buffer.from(authTagBase64, 'base64');

      // Get master key
      const masterKey = await this.getMasterKey();

      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, masterKey, iv);
      decipher.setAuthTag(authTag);

      // Set response headers
      res.setHeader('Content-Type', mimeType);

      // Create read stream and pipe through decipher to response
      const readStream = fs.createReadStream(encryptedPath);

      readStream.pipe(decipher).pipe(res);

      console.log('✅ [MEDIA ENCRYPTION] File streaming started');

    } catch (error) {
      console.error('❌ [MEDIA ENCRYPTION] Stream decryption failed:', error);
      throw error;
    }
  }

  /**
   * Check if a file is encrypted (has .enc extension and metadata)
   */
  isEncryptedFile(filePath) {
    return filePath && filePath.endsWith('.enc');
  }

  /**
   * Get original filename from encrypted filename
   */
  getOriginalFilename(encryptedFilename) {
    if (encryptedFilename.endsWith('.enc')) {
      return encryptedFilename.slice(0, -4);
    }
    return encryptedFilename;
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new MediaFileEncryption();
  }
  return instance;
}

module.exports = {
  MediaFileEncryption,
  getInstance
};
