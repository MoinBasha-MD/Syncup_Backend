const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');

const { protect } = require('../middleware/authMiddleware');
const { uploadLimiter } = require('../middleware/securityMiddleware');
const { verifyMediaToken } = require('../utils/mediaToken');

const Blob = require('../models/Blob');

const router = express.Router();

const BLOB_ID_RE = /^[0-9a-f]{32}$/;
const MAX_BLOB_SIZE = 200 * 1024 * 1024; // 200 MB — matches the upload limit

// Blobs live outside uploads/ so no static mount can ever serve them.
const baseDir = process.env.BLOB_STORAGE_DIR || path.join(__dirname, '..', 'storage', 'blobs');
if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true });
}

const newBlobId = () => crypto.randomBytes(16).toString('hex');

const blobPath = (blobId) => path.join(baseDir, path.basename(blobId));

/**
 * Bearer JWT (protect) OR a valid ?mt= media token. No DB hit for the token
 * path — verifyMediaToken returns the userId it was issued to.
 */
const protectOrMediaToken = (req, res, next) => {
  const mt = typeof req.query.mt === 'string' ? req.query.mt : null;
  if (mt && verifyMediaToken(mt)) {
    return next();
  }
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try {
      jwt.verify(header.slice(7), process.env.JWT_SECRET);
      return next();
    } catch {
      // fall through
    }
  }
  return res.status(401).json({
    success: false,
    message: 'Media access requires the Syncup app',
  });
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, baseDir),
  filename: (req, file, cb) => cb(null, newBlobId()),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BLOB_SIZE },
  // Ciphertext — accept any content type.
});

/**
 * POST / — upload an encrypted blob (multipart field `blob`,
 * application/octet-stream).
 */
router.post('/', protect, uploadLimiter, upload.single('blob'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Missing blob file' });
    }
    const blobId = path.basename(req.file.filename);
    if (!BLOB_ID_RE.test(blobId)) {
      fs.unlink(req.file.path, () => undefined);
      return res.status(500).json({ success: false, message: 'Upload failed' });
    }
    await Blob.create({
      blobId,
      ownerUserId: req.user.userId,
      size: req.file.size,
    });
    return res.status(201).json({ success: true, data: { blobId, size: req.file.size } });
  } catch (error) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => undefined);
    }
    console.error('❌ [BLOB] Upload failed:', error.message);
    return res.status(500).json({ success: false, message: 'Upload failed' });
  }
});

/**
 * GET /:blobId — stream a blob. Bearer or ?mt= accepted. sendFile handles
 * Range requests; dotfiles denied.
 */
router.get('/:blobId', protectOrMediaToken, async (req, res) => {
  try {
    const { blobId } = req.params;
    if (!BLOB_ID_RE.test(blobId)) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    res.set('Content-Type', 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    return res.sendFile(blobId, { root: baseDir, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ success: false, message: 'Not found' });
      }
    });
  } catch (error) {
    console.error('❌ [BLOB] Download failed:', error.message);
    return res.status(500).json({ success: false, message: 'Download failed' });
  }
});

/**
 * DELETE /:blobId — owner only.
 */
router.delete('/:blobId', protect, async (req, res) => {
  try {
    const { blobId } = req.params;
    if (!BLOB_ID_RE.test(blobId)) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    const blob = await Blob.findOne({ blobId });
    if (!blob) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    if (blob.ownerUserId !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Not the blob owner' });
    }
    await Blob.deleteOne({ blobId });
    fs.unlink(blobPath(blobId), () => undefined);
    return res.json({ success: true });
  } catch (error) {
    console.error('❌ [BLOB] Delete failed:', error.message);
    return res.status(500).json({ success: false, message: 'Delete failed' });
  }
});

module.exports = router;
