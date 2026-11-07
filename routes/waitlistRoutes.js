const express = require('express');
const rateLimit = require('express-rate-limit');
const WaitlistEntry = require('../models/WaitlistEntry');
const { verifyToken } = require('./adminAuthRoutes');

const router = express.Router();

// Deliberately strict: this form is public and has no captcha.
const joinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const countEntries = () => WaitlistEntry.countDocuments();

// POST /api/waitlist — public join
router.post('/', joinLimiter, async (req, res) => {
  const rawName = typeof req.body?.name === 'string' ? req.body.name : '';
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
  const name = rawName.trim().replace(/\s+/g, ' ');
  const email = rawEmail.trim().toLowerCase();

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({ success: false, message: 'Please enter your name.' });
  }
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }

  // Honeypot: hidden from people, filled by bots. Pretend success, write nothing.
  if (typeof req.body?.website === 'string' && req.body.website.trim()) {
    return res.json({ success: true, count: await countEntries().catch(() => 0) });
  }

  try {
    await WaitlistEntry.updateOne(
      { email },
      { $setOnInsert: { name, email, source: 'website' } },
      { upsert: true }
    );
    return res.json({ success: true, count: await countEntries() });
  } catch (error) {
    // Unique-index race between two identical submissions is still a success.
    if (error?.code === 11000) {
      return res.json({ success: true, count: await countEntries().catch(() => 0) });
    }
    console.error('[waitlist] join failed:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not save your details. Please try again.',
    });
  }
});

// GET /api/waitlist/count — public count for the site
router.get('/count', async (_req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.json({ success: true, count: await countEntries() });
  } catch (error) {
    console.error('[waitlist] count failed:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not load the waitlist count.',
    });
  }
});

// GET /api/waitlist — owner/super_admin only (name + email list)
router.get('/', verifyToken, (req, res, next) => {
  if (req.admin && (req.admin.role === 'owner' || req.admin.role === 'super_admin')) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Owner or super admin access required' });
}, async (req, res) => {
  const requested = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 1000) : 200;

  try {
    const [entries, count] = await Promise.all([
      WaitlistEntry.find()
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('name email source createdAt')
        .lean(),
      countEntries(),
    ]);
    return res.json({ success: true, count, entries });
  } catch (error) {
    console.error('[waitlist] list failed:', error);
    return res.status(500).json({ success: false, message: 'Could not load the waitlist.' });
  }
});

module.exports = router;
