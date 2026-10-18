const crypto = require('crypto');
const express = require('express');
const path = require('path');
const ejsLayouts = require('express-ejs-layouts');
const partnerService = require('../services/partnerService');
const PartnerAdminKey = require('../models/PartnerAdminKey');
const { digestSecret } = require('../utils/syncSpaceCrypto');
const sec = require('../middleware/partnerPortalSecurity');

const app = express();
app.disable('x-powered-by');
app.set('views', path.join(__dirname, '..', 'views', 'partners-admin'));
app.set('view engine', 'ejs');
app.set('view cache', process.env.NODE_ENV === 'production');
app.use(ejsLayouts);
app.set('layout', 'layout');

app.use(sec.portalHeaders);
app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'sync-space'), {
  index: false,
  maxAge: '1h',
}));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(sec.adminSession);
app.use(sec.ensureCsrfToken);
app.use(sec.sameOriginGuard);

const page = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

const invalidCredentials = () => 'Invalid access key';

app.get('/', (req, res) => {
  res.redirect(req.session && req.session.adminKeyId ? '/partners-admin/dashboard' : '/partners-admin/login');
});

app.get('/login', page(async (req, res) => {
  res.render('login', { title: 'Admin sign in', admin: null, error: null, values: {} });
}));

app.post('/login', sec.adminLoginLimiter, sec.requireCsrf, async (req, res, next) => {
  const fail = (status) => res.status(status).render('login', {
    title: 'Admin sign in',
    admin: null,
    error: invalidCredentials(),
    values: {},
  });
  try {
    const { key } = req.body || {};
    if (typeof key !== 'string' || !/^[0-9A-Za-z]{32}$/.test(key)) {
      return fail(401);
    }
    const digest = digestSecret(key);
    const record = await PartnerAdminKey.findOne({ secretHash: digest }).select('+secretHash');
    const valid = record &&
      crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(record.secretHash)) &&
      !record.revokedAt;
    if (!valid) return fail(401);
    await PartnerAdminKey.updateOne({ _id: record._id }, { $set: { lastUsedAt: new Date() } });
    await sec.signInAdmin(req, { keyId: record.keyId, label: record.label });
    return res.redirect('/partners-admin/dashboard');
  } catch (error) {
    return next(error);
  }
});

app.post('/logout', sec.requireCsrf, page(async (req, res) => {
  await sec.destroySession(req);
  res.redirect('/partners-admin/login');
}));

app.get('/dashboard', sec.requireAdmin, page(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
  const pageNum = Number.parseInt(req.query.page, 10);
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const sort = req.query.sort === 'oldest' ? 'oldest' : 'newest';
  const result = await partnerService.listPartnersAdmin({
    status,
    q,
    sort,
    page: Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1,
  });
  res.render('dashboard', {
    title: 'Partner approvals',
    admin: req.admin,
    status,
    result,
    error: null,
  });
}));

app.get('/partners/:partnerId', sec.requireAdmin, page(async (req, res) => {
  const detail = await partnerService.getPartnerAdminDetail(req.params.partnerId);
  res.render('detail', {
    title: detail.partner.businessName,
    admin: req.admin,
    detail,
    error: null,
  });
}));

app.post('/partners/:partnerId/review', sec.requireAdmin, sec.requireCsrf, page(async (req, res) => {
  const { decision, reason, expectedVersion } = req.body || {};
  await partnerService.reviewPartner(req.admin, req.params.partnerId, {
    decision,
    reason,
    expectedVersion: Number.parseInt(expectedVersion, 10),
  });
  res.redirect(`/partners-admin/partners/${req.params.partnerId}`);
}));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
  res.status(status).render('error', {
    title: status >= 500 ? 'Something went wrong' : 'Request failed',
    message: status >= 500 ? 'An unexpected error occurred.' : err.message,
    admin: res.locals.admin || null,
    partner: null,
  });
});

module.exports = app;
