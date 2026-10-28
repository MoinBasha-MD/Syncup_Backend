const crypto = require('crypto');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const rateLimit = require('express-rate-limit');
const PartnerAccount = require('../models/PartnerAccount');
const PartnerAdminKey = require('../models/PartnerAdminKey');
const { ServiceUnavailableError } = require('../utils/errorClasses');

const PORTAL_SESSION_COLLECTION = 'sync_space_portal_sessions';
const PARTNER_SESSION_MS = 8 * 60 * 60 * 1000;
const ADMIN_SESSION_MS = 60 * 60 * 1000;

const sessionSecret = () => {
  const secret = process.env.SYNC_SPACE_SESSION_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new ServiceUnavailableError('Sync Space portal is not configured');
  }
  return secret;
};

const buildSession = ({ name, path, maxAgeMs }) => {
  let middleware = null;
  return (req, res, next) => {
    if (!middleware) {
      middleware = session({
        name,
        secret: sessionSecret(),
        resave: false,
        saveUninitialized: false,
        proxy: true,
        store: MongoStore.create({
          mongoUrl: process.env.MONGO_URI,
          collectionName: PORTAL_SESSION_COLLECTION,
          ttl: Math.ceil(maxAgeMs / 1000),
        }),
        cookie: {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          maxAge: maxAgeMs,
          path,
        },
      });
    }
    return middleware(req, res, next);
  };
};

const partnerSession = buildSession({
  name: 'syncspace.partner.sid',
  path: '/partners',
  maxAgeMs: PARTNER_SESSION_MS,
});

const adminSession = buildSession({
  name: 'syncspace.admin.sid',
  path: '/partners-admin',
  maxAgeMs: ADMIN_SESSION_MS,
});

const portalHeaders = (req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
    "form-action 'self'; frame-ancestors 'none'"
  );
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  next();
};

const newCsrfToken = () => crypto.randomBytes(32).toString('base64url');

const ensureCsrfToken = (req, res, next) => {
  if (!req.session) return next(new ServiceUnavailableError('Session store unavailable'));
  if (typeof req.session.csrfToken !== 'string' || req.session.csrfToken.length < 20) {
    req.session.csrfToken = newCsrfToken();
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
};

const rotateCsrfToken = (req) => {
  req.session.csrfToken = newCsrfToken();
  return req.session.csrfToken;
};

const sameOriginGuard = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (origin) {
    const expected = process.env.SYNC_SPACE_PORTAL_ORIGIN || `${req.protocol}://${req.get('host')}`;
    if (origin !== expected) {
      return next(ForbiddenErrorLike('Cross-origin form submissions are not allowed'));
    }
  }
  return next();
};

const ForbiddenErrorLike = (message) => {
  const err = new Error(message);
  err.statusCode = 403;
  return err;
};

const requireCsrf = (req, res, next) => {
  const presented = req.body && req.body._csrf;
  const expected = req.session && req.session.csrfToken;
  const valid =
    typeof presented === 'string' &&
    typeof expected === 'string' &&
    presented.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
  if (!valid) return next(ForbiddenErrorLike('Invalid or missing form token'));
  return next();
};

const destroySession = (req) => new Promise((resolve) => {
  if (!req.session || typeof req.session.destroy !== 'function') return resolve();
  req.session.destroy(() => resolve());
});

const signInPartner = (req, partner) => new Promise((resolve, reject) => {
  req.session.regenerate((err) => {
    if (err) return reject(err);
    req.session.partnerId = partner.partnerId;
    req.session.partnerSessionVersion = partner.sessionVersion;
    req.session.csrfToken = newCsrfToken();
    resolve();
  });
});

const signInAdmin = (req, key) => new Promise((resolve, reject) => {
  req.session.regenerate((err) => {
    if (err) return reject(err);
    req.session.adminKeyId = key.keyId;
    req.session.adminLabel = key.label;
    req.session.csrfToken = newCsrfToken();
    resolve();
  });
});

const requirePartner = ({ allowSuspended = false } = {}) => async (req, res, next) => {
  try {
    const partnerId = req.session && req.session.partnerId;
    if (!partnerId) return res.redirect('/partners/login');
    const partner = await PartnerAccount.findOne({ partnerId });
    if (!partner || partner.sessionVersion !== req.session.partnerSessionVersion) {
      await destroySession(req);
      return res.redirect('/partners/login');
    }
    if (partner.approvalStatus === 'suspended' && !allowSuspended) {
      return res.status(403).render('error', {
        title: 'Account suspended',
        message: 'Your partner account has been suspended. Contact support if you believe this is a mistake.',
        partner: null,
      });
    }
    req.partner = partner;
    res.locals.partner = partner;
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireAdmin = async (req, res, next) => {
  try {
    const keyId = req.session && req.session.adminKeyId;
    if (!keyId) return res.redirect('/partners-admin/login');
    const key = await PartnerAdminKey.findOne({ keyId }).lean();
    if (!key || key.revokedAt) {
      await destroySession(req);
      return res.redirect('/partners-admin/login');
    }
    req.admin = { keyId: key.keyId, label: key.label };
    res.locals.admin = req.admin;
    return next();
  } catch (error) {
    return next(error);
  }
};

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render('error', {
    title: 'Too many attempts',
    message: 'Too many attempts, please try again later.',
    partner: null,
    admin: null,
  }),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render('error', {
    title: 'Too many attempts',
    message: 'Too many attempts, please try again later.',
    partner: null,
    admin: null,
  }),
});

module.exports = {
  partnerSession,
  adminSession,
  portalHeaders,
  ensureCsrfToken,
  rotateCsrfToken,
  sameOriginGuard,
  requireCsrf,
  requirePartner,
  requireAdmin,
  signInPartner,
  signInAdmin,
  destroySession,
  loginLimiter,
  adminLoginLimiter,
  newCsrfToken,
};
