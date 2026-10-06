const { ed25519 } = require('@noble/curves/ed25519');
const E2EEDevice = require('../models/E2EEDevice');
const Block = require('../models/blockModel');

const MAX_ACTIVE_DEVICES = 5;
const DEVICE_ID_REGEX = /^[0-9a-f]{32}$/;

const b64ToBytes = (value) => {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const bytes = Buffer.from(value, 'base64');
  // Require canonical base64 — Buffer.from is lenient about stray characters
  if (bytes.toString('base64') !== value) return null;
  return bytes;
};

const b64Length = (value, expectedBytes) => {
  const bytes = b64ToBytes(value);
  return bytes !== null && bytes.length === expectedBytes;
};

// SPK signature covers utf8("SYNCUP-SPK-v2|" + deviceId + "|" + spkId + "|") || spkPublicKeyBytes
const verifySignedPreKey = async (deviceId, spkId, spkPublicKey, signature, identityKey) => {
  const prefix = Buffer.from(`SYNCUP-SPK-v2|${deviceId}|${spkId}|`, 'utf8');
  const message = Buffer.concat([prefix, Buffer.from(spkPublicKey, 'base64')]);
  return await ed25519.verify(
    new Uint8Array(Buffer.from(signature, 'base64')),
    new Uint8Array(message),
    new Uint8Array(Buffer.from(identityKey, 'base64'))
  );
};

const validateBundle = ({ deviceId, identityKey, signedPreKey }) => {
  if (!DEVICE_ID_REGEX.test(deviceId || '')) return 'Invalid deviceId';
  if (!b64Length(identityKey, 32)) return 'Invalid identityKey';
  const spk = signedPreKey;
  if (!spk || typeof spk !== 'object') return 'Invalid signedPreKey';
  if (!Number.isInteger(spk.id) || spk.id <= 0) return 'Invalid signedPreKey.id';
  if (!b64Length(spk.publicKey, 32)) return 'Invalid signedPreKey.publicKey';
  if (!b64Length(spk.signature, 64)) return 'Invalid signedPreKey.signature';
  return null;
};

// @desc    Register or refresh an E2EE device (identity key + signed prekey)
// @route   POST /api/e2ee/devices
// @access  Private
const registerDevice = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { deviceId, identityKey, signedPreKey, capabilities } = req.body || {};

    const validationError = validateBundle({ deviceId, identityKey, signedPreKey });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    // capabilities: ≤10 short slugs like 'call-livekit-e2ee-v1'
    if (capabilities !== undefined) {
      const validCaps =
        Array.isArray(capabilities) &&
        capabilities.length <= 10 &&
        capabilities.every(
          (c) => typeof c === 'string' && c.length <= 40 && /^[a-z0-9-]+$/.test(c)
        );
      if (!validCaps) {
        return res.status(400).json({ success: false, message: 'Invalid capabilities' });
      }
    }

    if (!(await verifySignedPreKey(deviceId, signedPreKey.id, signedPreKey.publicKey, signedPreKey.signature, identityKey))) {
      return res.status(400).json({ success: false, message: 'Invalid signed prekey signature' });
    }

    const existing = await E2EEDevice.findOne({ userId, deviceId });
    if (existing && existing.identityKey !== identityKey) {
      return res.status(409).json({ success: false, message: 'Identity key is immutable for a device', code: 'IDENTITY_IMMUTABLE' });
    }

    if (!existing) {
      const activeCount = await E2EEDevice.countDocuments({ userId, revokedAt: null });
      if (activeCount >= MAX_ACTIVE_DEVICES) {
        return res.status(409).json({ success: false, message: 'Device limit reached', code: 'DEVICE_LIMIT' });
      }
    }

    const device = await E2EEDevice.findOneAndUpdate(
      { userId, deviceId },
      {
        $set: {
          userId,
          deviceId,
          identityKey,
          signedPreKey: {
            id: signedPreKey.id,
            publicKey: signedPreKey.publicKey,
            signature: signedPreKey.signature,
            createdAt: new Date(),
          },
          lastSeenAt: new Date(),
          revokedAt: null,
          ...(capabilities !== undefined ? { capabilities } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      data: {
        deviceId: device.deviceId,
        identityKey: device.identityKey,
        signedPreKey: device.signedPreKey,
      },
    });
  } catch (error) {
    console.error('❌ [E2EE] registerDevice error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to register device' });
  }
};

// @desc    Rotate a device's signed prekey (id must increase)
// @route   PUT /api/e2ee/devices/:deviceId/signed-prekey
// @access  Private
const rotateSignedPreKey = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { deviceId } = req.params;
    const { signedPreKey } = req.body || {};

    const device = await E2EEDevice.findOne({ userId, deviceId, revokedAt: null });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    if (!signedPreKey || typeof signedPreKey !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid signedPreKey' });
    }
    if (!Number.isInteger(signedPreKey.id) || signedPreKey.id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid signedPreKey.id' });
    }
    if (!b64Length(signedPreKey.publicKey, 32) || !b64Length(signedPreKey.signature, 64)) {
      return res.status(400).json({ success: false, message: 'Invalid signedPreKey material' });
    }
    if (signedPreKey.id <= device.signedPreKey.id) {
      return res.status(400).json({ success: false, message: 'signedPreKey.id must increase' });
    }
    if (!(await verifySignedPreKey(deviceId, signedPreKey.id, signedPreKey.publicKey, signedPreKey.signature, device.identityKey))) {
      return res.status(400).json({ success: false, message: 'Invalid signed prekey signature' });
    }

    device.signedPreKey = {
      id: signedPreKey.id,
      publicKey: signedPreKey.publicKey,
      signature: signedPreKey.signature,
      createdAt: new Date(),
    };
    device.lastSeenAt = new Date();
    await device.save();

    return res.status(200).json({ success: true, data: { deviceId: device.deviceId, signedPreKey: device.signedPreKey } });
  } catch (error) {
    console.error('❌ [E2EE] rotateSignedPreKey error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to rotate signed prekey' });
  }
};

// @desc    List a user's active E2EE devices (empty if none or blocked)
// @route   GET /api/e2ee/users/:userId/devices
// @access  Private
const getUserDevices = async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    const blockStatus = await Block.isMutuallyBlocked(req.user.userId, targetUserId);
    if (blockStatus && blockStatus.anyBlocked) {
      return res.status(200).json({ success: true, data: [] });
    }

    const devices = await E2EEDevice.find({ userId: targetUserId, revokedAt: null })
      .select('deviceId identityKey signedPreKey capabilities -_id')
      .lean();

    return res.status(200).json({ success: true, data: devices });
  } catch (error) {
    console.error('❌ [E2EE] getUserDevices error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch devices' });
  }
};

// @desc    List own active E2EE devices
// @route   GET /api/e2ee/devices
// @access  Private
const getOwnDevices = async (req, res) => {
  try {
    const devices = await E2EEDevice.find({ userId: req.user.userId, revokedAt: null })
      .select('deviceId identityKey signedPreKey capabilities lastSeenAt createdAt -_id')
      .lean();

    return res.status(200).json({ success: true, data: devices });
  } catch (error) {
    console.error('❌ [E2EE] getOwnDevices error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch devices' });
  }
};

// @desc    Revoke own device
// @route   DELETE /api/e2ee/devices/:deviceId
// @access  Private
const revokeDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = await E2EEDevice.findOne({ userId: req.user.userId, deviceId, revokedAt: null });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    device.revokedAt = new Date();
    await device.save();

    return res.status(200).json({ success: true, data: { deviceId } });
  } catch (error) {
    console.error('❌ [E2EE] revokeDevice error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to revoke device' });
  }
};

// ---------------------------------------------------------------------------
// Encrypted backup — pointer to the owner's opaque SYNCUP-MEDIA-v1 blob.
// ---------------------------------------------------------------------------

const E2EEBackup = require('../models/E2EEBackup');
const Blob = require('../models/Blob');
const path = require('path');
const fs = require('fs');

const BLOB_ID_RE = /^[0-9a-f]{32}$/;
const BACKUP_BLOB_DIR = process.env.BLOB_STORAGE_DIR || path.join(__dirname, '..', 'storage', 'blobs');
const BACKUP_PUT_LIMIT = 10;
const BACKUP_PUT_WINDOW_MS = 24 * 60 * 60 * 1000;
const backupPutLog = new Map(); // userId -> timestamps[]

const backupPutRateLimited = (userId) => {
  const now = Date.now();
  const log = (backupPutLog.get(userId) || []).filter(t => now - t < BACKUP_PUT_WINDOW_MS);
  backupPutLog.set(userId, log);
  if (log.length >= BACKUP_PUT_LIMIT) return true;
  log.push(now);
  return false;
};

const deleteBlobStorage = async (blobId) => {
  try {
    await Blob.deleteOne({ blobId });
  } catch {}
  try {
    fs.unlinkSync(path.join(BACKUP_BLOB_DIR, path.basename(blobId)));
  } catch {}
};

// @route PUT /api/e2ee/backup
const putBackup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { blobId, noncePrefix, encSize, encSha256, createdAt } = req.body || {};

    if (!BLOB_ID_RE.test(blobId || '')) {
      return res.status(400).json({ success: false, code: 'INVALID_BLOB', message: 'Invalid blobId' });
    }
    if (typeof noncePrefix !== 'string' || noncePrefix.length === 0 || noncePrefix.length > 64) {
      return res.status(400).json({ success: false, code: 'INVALID_NONCE', message: 'Invalid noncePrefix' });
    }
    if (!Number.isInteger(encSize) || encSize < 0 || encSize > 200 * 1024 * 1024) {
      return res.status(400).json({ success: false, code: 'INVALID_SIZE', message: 'Invalid encSize' });
    }
    if (typeof encSha256 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encSha256)) {
      return res.status(400).json({ success: false, code: 'INVALID_HASH', message: 'Invalid encSha256' });
    }
    const created = createdAt ? new Date(createdAt) : new Date();
    if (Number.isNaN(created.getTime())) {
      return res.status(400).json({ success: false, code: 'INVALID_DATE', message: 'Invalid createdAt' });
    }

    if (backupPutRateLimited(userId)) {
      return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'Too many backups — try again later' });
    }

    // The blob must be owned by the caller — nobody may point their backup
    // record at someone else's ciphertext.
    const blob = await Blob.findOne({ blobId, ownerUserId: userId });
    if (!blob) {
      return res.status(404).json({ success: false, code: 'BLOB_NOT_FOUND', message: 'Blob not found' });
    }

    const previous = await E2EEBackup.findOne({ userId });
    const previousBlobId = previous?.blobId;

    await E2EEBackup.findOneAndUpdate(
      { userId },
      { userId, blobId, noncePrefix, encSize, encSha256, createdAt: created },
      { upsert: true, new: true },
    );

    // The superseded blob is useless once replaced — free the storage.
    if (previousBlobId && previousBlobId !== blobId) {
      await deleteBlobStorage(previousBlobId);
    }

    return res.json({ success: true, data: { blobId, createdAt: created } });
  } catch (error) {
    console.error('❌ [E2EE] putBackup error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to store backup' });
  }
};

// @route GET /api/e2ee/backup — own record only
const getBackup = async (req, res) => {
  try {
    const userId = req.user.userId;
    const record = await E2EEBackup.findOne({ userId }).lean();
    if (!record) {
      return res.status(404).json({ success: false, message: 'No backup found' });
    }
    return res.json({
      success: true,
      data: {
        blobId: record.blobId,
        noncePrefix: record.noncePrefix,
        encSize: record.encSize,
        encSha256: record.encSha256,
        createdAt: record.createdAt,
      },
    });
  } catch (error) {
    console.error('❌ [E2EE] getBackup error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load backup' });
  }
};

module.exports = {
  registerDevice,
  rotateSignedPreKey,
  getUserDevices,
  getOwnDevices,
  revokeDevice,
  putBackup,
  getBackup,
};
