const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const User = require('../models/userModel');

/**
 * Key Exchange Endpoint
 * POST /api/crypto/key-exchange
 * 
 * Allows users to exchange public keys for E2EE.
 * Server never computes shared secrets or decrypts data.
 */
router.post('/key-exchange', protect, async (req, res) => {
  try {
    const { targetUserId, myPublicKey, myX25519PublicKey } = req.body;
    const currentUserId = req.user.userId;
    
    console.log('🔑 [KEY EXCHANGE] Request from:', currentUserId, 'to:', targetUserId);
    
    // Update current user's public keys
    await User.findOneAndUpdate(
      { userId: currentUserId },
      {
        $set: {
          'devicePublicKeys.0': {
            deviceId: currentUserId,
            publicKey: myPublicKey,
            x25519PublicKey: myX25519PublicKey,
            addedAt: new Date(),
            lastUsed: new Date(),
          }
        }
      },
      { upsert: false }
    );
    
    // Get target user's public keys
    const targetUser = await User.findOne({ userId: targetUserId });
    
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'Target user not found'
      });
    }
    
    // Check if target user has public keys
    if (!targetUser.devicePublicKeys || targetUser.devicePublicKeys.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Target user has not initialized E2EE keys'
      });
    }
    
    const targetKeys = targetUser.devicePublicKeys[0];
    
    console.log('✅ [KEY EXCHANGE] Keys exchanged successfully');
    
    // Return target user's public keys (server never computes shared secret)
    res.json({
      success: true,
      data: {
        userId: targetUserId,
        publicKey: targetKeys.publicKey,
        x25519PublicKey: targetKeys.x25519PublicKey,
      }
    });
    
  } catch (error) {
    console.error('❌ [KEY EXCHANGE] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Key exchange failed',
      error: error.message
    });
  }
});

/**
 * Get user's own public keys
 * GET /api/crypto/my-keys
 */
router.get('/my-keys', protect, async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    
    const user = await User.findOne({ userId: currentUserId });
    
    if (!user || !user.devicePublicKeys || user.devicePublicKeys.length === 0) {
      return res.json({
        success: true,
        data: null,
        message: 'No keys found'
      });
    }
    
    res.json({
      success: true,
      data: {
        publicKey: user.devicePublicKeys[0].publicKey,
        x25519PublicKey: user.devicePublicKeys[0].x25519PublicKey,
        deviceId: user.devicePublicKeys[0].deviceId,
      }
    });
    
  } catch (error) {
    console.error('❌ [GET MY KEYS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get keys',
      error: error.message
    });
  }
});

module.exports = router;
