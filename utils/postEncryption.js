const crypto = require('crypto');
const { getInstance: getKeyVault } = require('./honeypotKeyVault');

/**
 * Post Content Encryption Utility
 * 
 * Encrypts sensitive post data (captions, locations, comments)
 * Uses AES-256-GCM for authenticated encryption
 * 
 * IMPORTANT: This is server-side encryption for data at rest.
 * Posts are still visible to the server during processing.
 * For true E2EE posts, client-side encryption would be needed.
 */
class PostEncryption {
  constructor() {
    // Master encryption key from honeypot vault
    this.masterKey = null; // Will be loaded from vault
    this.keyVault = null;
    this.algorithm = 'aes-256-gcm';
    this.ivLength = 16; // 128 bits
    this.authTagLength = 16; // 128 bits
    this.saltLength = 32; // 256 bits
    this.pbkdf2Iterations = 100000;
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

      const keyHex = await this.keyVault.getKey('POST_ENCRYPTION_KEY', this.serverSignature);
      this.masterKey = Buffer.from(keyHex, 'hex');

      console.log('✅ [POST ENCRYPTION] Master key loaded from vault');
      return this.masterKey;
    } catch (error) {
      console.error('❌ [POST ENCRYPTION] Failed to load key from vault:', error);
      throw new Error('Failed to initialize post encryption');
    }
  }

  /**
   * Derive encryption key from master key using PBKDF2
   */
  async deriveKey(salt) {
    const masterKey = await this.getMasterKey();
    return crypto.pbkdf2Sync(
      masterKey,
      salt,
      this.pbkdf2Iterations,
      32, // 256 bits
      'sha256'
    );
  }

  /**
   * Encrypt text content (caption, location name, etc.)
   * 
   * @param {string} plaintext - Text to encrypt
   * @returns {string} - Base64 encoded: salt:iv:authTag:ciphertext
   */
  async encryptText(plaintext) {
    if (!plaintext || plaintext.trim() === '') {
      return plaintext; // Don't encrypt empty strings
    }

    try {
      // Generate random salt and IV
      const salt = crypto.randomBytes(this.saltLength);
      const iv = crypto.randomBytes(this.ivLength);

      // Derive encryption key
      const key = await this.deriveKey(salt);

      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);

      // Encrypt
      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
      ]);

      // Get authentication tag
      const authTag = cipher.getAuthTag();

      // Combine: salt:iv:authTag:ciphertext (all base64)
      const result = [
        salt.toString('base64'),
        iv.toString('base64'),
        authTag.toString('base64'),
        encrypted.toString('base64')
      ].join(':');

      return result;

    } catch (error) {
      console.error('❌ [POST ENCRYPTION] Encryption failed:', error.message);
      throw new Error('Failed to encrypt text');
    }
  }

  /**
   * Decrypt text content
   * 
   * @param {string} encryptedText - Base64 encoded: salt:iv:authTag:ciphertext
   * @returns {string} - Decrypted plaintext
   */
  async decryptText(encryptedText) {
    if (!encryptedText || encryptedText.trim() === '') {
      return encryptedText; // Return empty strings as-is
    }

    // Check if text is encrypted (contains colons)
    if (!encryptedText.includes(':')) {
      // Not encrypted, return as-is (backward compatibility)
      return encryptedText;
    }

    try {
      // Split components
      const parts = encryptedText.split(':');
      if (parts.length !== 4) {
        // console.warn('⚠️ [POST ENCRYPTION] Invalid encrypted text format, returning as-is');
        return encryptedText;
      }

      const [saltB64, ivB64, authTagB64, ciphertextB64] = parts;

      // Validate base64 format before decoding
      try {
        // Decode from base64
        const salt = Buffer.from(saltB64, 'base64');
        const iv = Buffer.from(ivB64, 'base64');
        const authTag = Buffer.from(authTagB64, 'base64');
        const ciphertext = Buffer.from(ciphertextB64, 'base64');

        // Validate buffer lengths
        if (salt.length !== this.saltLength || 
            iv.length !== this.ivLength || 
            authTag.length !== this.authTagLength) {
          // Invalid lengths - not actually encrypted
          return encryptedText;
        }

        // Derive encryption key
        const key = await this.deriveKey(salt);

        // Create decipher
        const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
        decipher.setAuthTag(authTag);

        // Decrypt
        const decrypted = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final()
        ]);

        return decrypted.toString('utf8');
      } catch (bufferError) {
        // Invalid base64 or decryption failed - return as-is
        return encryptedText;
      }

    } catch (error) {
      // Silently return encrypted text as-is for graceful degradation
      return encryptedText;
    }
  }

  /**
   * Encrypt post object (caption, location)
   * 
   * @param {Object} post - Post object with caption, location
   * @returns {Object} - Post with encrypted fields
   */
  async encryptPost(post) {
    const encrypted = { ...post };

    try {
      // Encrypt caption if present
      if (post.caption) {
        encrypted.caption = await this.encryptText(post.caption);
        encrypted._captionEncrypted = true;
      }

      // Encrypt location name if present
      if (post.location && post.location.name) {
        encrypted.location = {
          ...post.location,
          name: await this.encryptText(post.location.name),
          _nameEncrypted: true
        };
      }

      console.log('✅ [POST ENCRYPTION] Post encrypted');
      return encrypted;

    } catch (error) {
      console.error('❌ [POST ENCRYPTION] Post encryption failed:', error.message);
      // Return original post if encryption fails
      return post;
    }
  }

  /**
   * Decrypt post object
   * 
   * @param {Object} post - Post object with encrypted fields
   * @returns {Object} - Post with decrypted fields
   */
  async decryptPost(post) {
    const decrypted = { ...post };

    try {
      // Decrypt caption if present
      if (post.caption && post._captionEncrypted) {
        decrypted.caption = await this.decryptText(post.caption);
        delete decrypted._captionEncrypted;
      }

      // Decrypt location name if present
      if (post.location && post.location.name && post.location._nameEncrypted) {
        decrypted.location = {
          ...post.location,
          name: await this.decryptText(post.location.name)
        };
        delete decrypted.location._nameEncrypted;
      }

      return decrypted;

    } catch (error) {
      console.error('❌ [POST ENCRYPTION] Post decryption failed:', error.message);
      // Return original post if decryption fails
      return post;
    }
  }

  /**
   * Encrypt array of posts
   */
  async encryptPosts(posts) {
    return Promise.all(posts.map(post => this.encryptPost(post)));
  }

  /**
   * Decrypt array of posts
   */
  async decryptPosts(posts) {
    return Promise.all(posts.map(post => this.decryptPost(post)));
  }

  /**
   * Check if text is encrypted
   * Validates format: salt:iv:authTag:ciphertext (all base64)
   */
  isEncrypted(text) {
    if (!text || typeof text !== 'string') return false;
    
    // Encrypted format: base64:base64:base64:base64
    const parts = text.split(':');
    if (parts.length !== 4) return false;
    
    // Validate each part is valid base64 and has expected length
    const [saltB64, ivB64, authTagB64, ciphertextB64] = parts;
    
    // Base64 regex pattern
    const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
    
    // Check all parts are valid base64
    if (!base64Pattern.test(saltB64) || 
        !base64Pattern.test(ivB64) || 
        !base64Pattern.test(authTagB64) || 
        !base64Pattern.test(ciphertextB64)) {
      return false;
    }
    
    // Validate expected lengths (base64 encoded)
    // Salt: 32 bytes = 44 chars base64
    // IV: 16 bytes = 24 chars base64
    // AuthTag: 16 bytes = 24 chars base64
    // Ciphertext: variable but should be at least 16 chars
    const saltLen = saltB64.replace(/=/g, '').length;
    const ivLen = ivB64.replace(/=/g, '').length;
    const authTagLen = authTagB64.replace(/=/g, '').length;
    const cipherLen = ciphertextB64.replace(/=/g, '').length;
    
    // Allow some tolerance for base64 padding
    if (saltLen < 42 || saltLen > 44) return false;
    if (ivLen < 22 || ivLen > 24) return false;
    if (authTagLen < 22 || authTagLen > 24) return false;
    if (cipherLen < 16) return false; // Minimum ciphertext length
    
    return true;
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new PostEncryption();
  }
  return instance;
}

module.exports = {
  PostEncryption,
  getInstance
};
