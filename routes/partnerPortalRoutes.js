const express = require('express');
const path = require('path');
const ejsLayouts = require('express-ejs-layouts');
const partnerService = require('../services/partnerService');
const partnerSpaceService = require('../services/partnerSpaceService');
const { BUSINESS_SCOPES } = require('../services/syncSpacePermissions');
const sec = require('../middleware/partnerPortalSecurity');

const app = express();
app.disable('x-powered-by');
app.set('views', path.join(__dirname, '..', 'views', 'partners'));
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
app.use(sec.partnerSession);
app.use(sec.ensureCsrfToken);
app.use(sec.sameOriginGuard);

const page = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

const formPage = (view, buildLocals) => (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.statusCode && error.statusCode < 500) {
      return res.status(error.statusCode).render(view, buildLocals(req, error));
    }
    next(error);
  }
};

const formValues = (req, allowed) => {
  const values = {};
  for (const key of allowed) {
    const value = req.body ? req.body[key] : undefined;
    if (typeof value === 'string') values[key] = value;
  }
  return values;
};

const scopesList = (body) => {
  const raw = body ? body.requestedScopes : undefined;
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((value) => typeof value === 'string');
};

const redirectUrisList = (body) => {
  const raw = body ? body.redirectUris : undefined;
  if (typeof raw !== 'string') return undefined;
  return raw.split('\n').map((line) => line.trim()).filter(Boolean);
};

app.get('/', (req, res) => {
  res.redirect(req.session && req.session.partnerId ? '/partners/dashboard' : '/partners/login');
});

app.get('/register', page(async (req, res) => {
  res.render('register', { title: 'Create account', partner: null, error: null, values: {} });
}));

app.post('/register', sec.loginLimiter, sec.requireCsrf, formPage('register', (req, error) => ({
  title: 'Create account',
  partner: null,
  error: error.message,
  values: formValues(req, ['businessName', 'email', 'website']),
}))(async (req, res) => {
  const { email, password, businessName, website } = req.body || {};
  const result = await partnerService.createPartner({ email, password, businessName, website });
  res.status(201).render('verify', {
    title: 'Verify your email',
    partner: null,
    challengeId: result.challengeId,
    email: result.partner.email,
    error: result.emailSent ? null : 'We could not send the email just now. Use resend below.',
    resent: false,
  });
}));

app.get('/verify', page(async (req, res) => {
  res.render('verify', {
    title: 'Verify your email',
    partner: null,
    challengeId: typeof req.query.challengeId === 'string' ? req.query.challengeId : '',
    email: '',
    error: null,
    resent: false,
  });
}));

app.post('/verify', sec.requireCsrf, formPage('verify', (req, error) => ({
  title: 'Verify your email',
  partner: null,
  challengeId: formValues(req, ['challengeId']).challengeId || '',
  email: '',
  error: error.message,
  resent: false,
}))(async (req, res) => {
  const { challengeId, code } = req.body || {};
  await partnerService.verifyPartnerEmail({ challengeId, code });
  res.redirect('/partners/login?verified=1');
}));

app.post('/resend', sec.requireCsrf, formPage('verify', (req, error) => ({
  title: 'Verify your email',
  partner: null,
  challengeId: formValues(req, ['challengeId']).challengeId || '',
  email: '',
  error: error.message,
  resent: false,
}))(async (req, res) => {
  const { challengeId } = req.body || {};
  const result = await partnerService.resendChallenge({ challengeId, purpose: 'verify' });
  if (result.alreadyVerified) return res.redirect('/partners/login?verified=1');
  res.render('verify', {
    title: 'Verify your email',
    partner: null,
    challengeId: result.challengeId,
    email: '',
    error: result.sent ? null : 'We could not send the email just now. Try again shortly.',
    resent: result.sent,
  });
}));

app.get('/login', page(async (req, res) => {
  res.render('login', {
    title: 'Sign in',
    partner: null,
    error: null,
    notice: req.query.verified ? 'Email verified — you can sign in now.'
      : req.query.reset ? 'Password updated — sign in with your new password.'
      : null,
    values: {},
  });
}));

app.post('/login', sec.loginLimiter, sec.requireCsrf, formPage('login', (req, error) => ({
  title: 'Sign in',
  partner: null,
  error: error.statusCode === 401 ? 'Invalid email or password' : error.message,
  notice: null,
  values: formValues(req, ['email']),
}))(async (req, res) => {
  const { email, password } = req.body || {};
  const partner = await partnerService.authenticatePartner(email, password);
  await sec.signInPartner(req, partner);
  res.redirect('/partners/dashboard');
}));

app.post('/logout', sec.requireCsrf, page(async (req, res) => {
  await sec.destroySession(req);
  res.redirect('/partners/login');
}));

app.get('/forgot', page(async (req, res) => {
  res.render('forgot', { title: 'Reset password', partner: null, error: null, sent: false });
}));

app.post('/forgot', sec.loginLimiter, sec.requireCsrf, page(async (req, res) => {
  const { email } = req.body || {};
  await partnerService.requestPasswordReset(email);
  res.render('forgot', {
    title: 'Reset password',
    partner: null,
    error: null,
    sent: true,
  });
}));

app.get('/reset', page(async (req, res) => {
  res.render('reset', {
    title: 'Choose a new password',
    partner: null,
    challengeId: typeof req.query.challengeId === 'string' ? req.query.challengeId : '',
    error: null,
    done: false,
  });
}));

app.post('/reset', sec.requireCsrf, formPage('reset', (req, error) => ({
  title: 'Choose a new password',
  partner: null,
  challengeId: formValues(req, ['challengeId']).challengeId || '',
  error: error.message,
  done: false,
}))(async (req, res) => {
  const { challengeId, code, password } = req.body || {};
  await partnerService.resetPassword({ challengeId, code, password });
  await sec.destroySession(req);
  res.redirect('/partners/login?reset=1');
}));

app.get('/dashboard', sec.requirePartner({ allowSuspended: true }), page(async (req, res) => {
  const apps = req.partner.approvalStatus === 'suspended'
    ? []
    : await partnerService.listApps(req.partner.partnerId);
  res.render('dashboard', {
    title: 'Overview',
    partner: partnerService.partnerDto(req.partner),
    apps,
  });
}));

app.get('/review', sec.requirePartner({ allowSuspended: true }), page(async (req, res) => {
  const detail = await partnerService.getPartnerPortalDetail(req.partner.partnerId);
  res.render('review', {
    title: 'Go live',
    partner: detail,
    error: null,
    values: { useCase: detail.useCase, privacyPolicyUrl: detail.privacyPolicyUrl },
  });
}));

app.post('/production-request', sec.requirePartner(), sec.requireCsrf, formPage('review', (req, error) => ({
  title: 'Go live',
  partner: partnerService.partnerDto(req.partner),
  error: error.message,
  values: formValues(req, ['useCase', 'privacyPolicyUrl']),
}))(async (req, res) => {
  const { useCase, privacyPolicyUrl } = req.body || {};
  await partnerService.requestProduction(req.partner.partnerId, { useCase, privacyPolicyUrl });
  res.redirect('/partners/review');
}));

app.post('/resend-verification', sec.requirePartner(), sec.requireCsrf, page(async (req, res) => {
  const result = await partnerService.requestVerificationEmail(req.partner.partnerId);
  if (result.alreadyVerified) return res.redirect('/partners/dashboard');
  return res.render('verify', {
    title: 'Verify your email',
    partner: partnerService.partnerDto(req.partner),
    challengeId: result.challengeId,
    email: req.partner.email,
    error: result.sent ? null : 'We could not send the email just now. Try again shortly.',
    resent: result.sent,
  });
}));

app.get('/apps/new', sec.requirePartner(), page(async (req, res) => {
  res.render('app', {
    title: 'New integration',
    partner: partnerService.partnerDto(req.partner),
    mode: 'new',
    app: null,
    keys: [],
    error: null,
    values: { applicationType: 'web', kind: 'app', environment: 'sandbox' },
    scopes: require('../services/syncSpacePermissions').ALL_SCOPES,
  });
}));

app.post('/apps', sec.requirePartner(), sec.requireCsrf, formPage('app', (req, error) => ({
  title: 'New integration',
  partner: partnerService.partnerDto(req.partner),
  mode: 'new',
  app: null,
  keys: [],
  error: error.message,
  values: formValues(req, ['name', 'kind', 'applicationType', 'environment', 'website', 'redirectUris']),
  scopes: require('../services/syncSpacePermissions').ALL_SCOPES,
}))(async (req, res) => {
  const { name, kind, applicationType, environment, website } = req.body || {};
  const result = await partnerService.createApp(req.partner.partnerId, {
    name,
    kind,
    applicationType,
    environment,
    website,
    requestedScopes: scopesList(req.body) || [],
    redirectUris: redirectUrisList(req.body) || [],
  });
  if (result.clientSecret) {
    return res.status(201).render('key', {
      title: 'Client secret created',
      partner: partnerService.partnerDto(req.partner),
      app: result.app,
      credential: { kind: 'client-secret', value: result.clientSecret },
      record: null,
    });
  }
  res.redirect(`/partners/apps/${result.app.appId}`);
}));

const renderAppDetail = async (req, res, error = null) => {
  const appDoc = await partnerService.getApp(req.partner.partnerId, req.params.appId);
  const keys = await partnerService.listApiKeys(req.partner.partnerId, req.params.appId);
  const testers = appDoc.environment === 'sandbox'
    ? await partnerService.listSandboxTesters(req.partner.partnerId, req.params.appId)
    : [];
  const customers = await partnerService.listAppConnections(
    req.partner.partnerId,
    req.params.appId,
    { cursor: req.query.cursor }
  );
  const deliveries = await partnerService.listWebhookDeliveries(req.partner.partnerId, req.params.appId);
  res.render('app', {
    title: appDoc.name,
    partner: partnerService.partnerDto(req.partner),
    mode: 'detail',
    app: appDoc,
    keys,
    testers,
    customers,
    deliveries,
    error,
    values: {},
    scopes: require('../services/syncSpacePermissions').ALL_SCOPES,
  });
};

app.get('/apps/:appId', sec.requirePartner(), page(renderAppDetail));

// ---- Connect a customer (QR scan / OTP fallback) -------------------------

const appUsableError = (appDoc, partner) => {
  if (appDoc.status !== 'active') return 'This integration is disabled.';
  if (appDoc.environment === 'live' && partner.approvalStatus !== 'approved') {
    return 'Live integrations need an approved partner account before pairing.';
  }
  return null;
};

// The portal acts as the app owner — credentials get the app's own scopes.
const portalCredentials = (appDoc) => ({
  app: appDoc,
  key: { scopes: (appDoc.requestedScopes || []).filter((s) => BUSINESS_SCOPES.includes(s)) },
});

const renderConnectPage = (req, res, locals) => {
  res.setHeader('Permissions-Policy', 'camera=(self)');
  res.render('connect', {
    title: 'Connect a customer',
    partner: partnerService.partnerDto(req.partner),
    unusable: null,
    result: null,
    otpStep: null,
    values: {},
    ...locals,
  });
};

app.get('/apps/:appId/connect', sec.requirePartner(), page(async (req, res) => {
  const appDoc = await partnerService.getApp(req.partner.partnerId, req.params.appId);
  renderConnectPage(req, res, { app: appDoc, unusable: appUsableError(appDoc, req.partner) });
}));

app.post('/apps/:appId/connect/scan', sec.requirePartner(), sec.requireCsrf, page(async (req, res) => {
  const appDoc = await partnerService.getApp(req.partner.partnerId, req.params.appId);
  const unusable = appUsableError(appDoc, req.partner);
  if (unusable) return renderConnectPage(req, res, { app: appDoc, unusable });
  try {
    const result = await partnerSpaceService.pairByQr(
      portalCredentials(appDoc),
      req.body && req.body.qrPayload
    );
    return renderConnectPage(req, res, { app: appDoc, result: { ok: true, ...result } });
  } catch (error) {
    const message = error.code === 'PAIRING_INVALID'
      ? 'That QR code is invalid or expired.'
      : 'Pairing failed. Please try again.';
    return renderConnectPage(req, res, {
      app: appDoc,
      result: { ok: false, message },
      values: formValues(req, ['qrPayload']),
    });
  }
}));

app.post('/apps/:appId/connect/otp', sec.requirePartner(), sec.requireCsrf, page(async (req, res) => {
  const appDoc = await partnerService.getApp(req.partner.partnerId, req.params.appId);
  const unusable = appUsableError(appDoc, req.partner);
  if (unusable) return renderConnectPage(req, res, { app: appDoc, unusable });
  const result = await partnerSpaceService.requestOtpPairing(
    portalCredentials(appDoc),
    req.body && req.body.identifier
  );
  return renderConnectPage(req, res, {
    app: appDoc,
    otpStep: { pairingId: result.pairingId, expiresAt: result.expiresAt },
  });
}));

app.post('/apps/:appId/connect/verify', sec.requirePartner(), sec.requireCsrf, page(async (req, res) => {
  const appDoc = await partnerService.getApp(req.partner.partnerId, req.params.appId);
  const unusable = appUsableError(appDoc, req.partner);
  if (unusable) return renderConnectPage(req, res, { app: appDoc, unusable });
  const { pairingId, code } = req.body || {};
  try {
    const result = await partnerSpaceService.verifyOtpPairing(
      portalCredentials(appDoc),
      pairingId,
      code
    );
    return renderConnectPage(req, res, { app: appDoc, result: { ok: true, ...result } });
  } catch (error) {
    return renderConnectPage(req, res, {
      app: appDoc,
      result: { ok: false, message: 'That code is invalid or expired.' },
      otpStep: { pairingId, expiresAt: null },
    });
  }
}));

// ---- Webhooks --------------------------------------------------------------

app.post('/apps/:appId/webhook', sec.requirePartner(), sec.requireCsrf, async (req, res, next) => {
  try {
    await partnerService.setWebhookUrl(req.partner.partnerId, req.params.appId, req.body && req.body.webhookUrl);
    res.redirect(`/partners/apps/${req.params.appId}`);
  } catch (error) {
    if (error.statusCode && error.statusCode < 500) {
      try {
        return await renderAppDetail(req, res, error.message);
      } catch (inner) {
        return next(inner);
      }
    }
    return next(error);
  }
});

app.post('/apps/:appId/webhook-secret', sec.requirePartner(), sec.requireCsrf, page(async (req, res) => {
  const result = await partnerService.rotateWebhookSecret(req.partner.partnerId, req.params.appId);
  res.render('key', {
    title: 'Webhook signing secret',
    partner: partnerService.partnerDto(req.partner),
    app: { appId: req.params.appId, name: result.app && result.app.name },
    credential: { kind: 'webhook-secret', value: result.secret },
    record: null,
  });
}));

app.post('/apps/:appId/testers', sec.requirePartner(), sec.requireCsrf, async (req, res, next) => {
  try {
    await partnerService.addSandboxTester(req.partner.partnerId, req.params.appId, req.body && req.body.syncId);
    res.redirect(`/partners/apps/${req.params.appId}`);
  } catch (error) {
    if (error.statusCode && error.statusCode < 500) {
      try {
        return await renderAppDetail(req, res, error.message);
      } catch (inner) {
        return next(inner);
      }
    }
    return next(error);
  }
});

app.post('/apps/:appId/testers/remove', sec.requirePartner(), sec.requireCsrf, page(async (req, res) => {
  await partnerService.removeSandboxTester(req.partner.partnerId, req.params.appId, req.body && req.body.syncId);
  res.redirect(`/partners/apps/${req.params.appId}`);
}));

app.post('/apps/:appId/update', sec.requirePartner(), sec.requireCsrf, page(async (req, res) => {
  const body = req.body || {};
  const update = {};
  if (Object.hasOwn(body, 'name')) update.name = body.name;
  if (Object.hasOwn(body, 'website')) update.website = body.website;
  if (Object.hasOwn(body, 'redirectUris')) update.redirectUris = redirectUrisList(body);
  if (Object.hasOwn(body, 'requestedScopes')) update.requestedScopes = scopesList(body);
  await partnerService.updateApp(req.partner.partnerId, req.params.appId, update);
  res.redirect(`/partners/apps/${req.params.appId}`);
}));

app.post('/apps/:appId/disable', sec.requirePartner(), sec.requireCsrf, page(async (req, res) => {
  await partnerService.disableApp(req.partner.partnerId, req.params.appId);
  res.redirect(`/partners/apps/${req.params.appId}`);
}));

app.post('/apps/:appId/keys', sec.requirePartner(), sec.requireCsrf, page(async (req, res) => {
  const { name } = req.body || {};
  const result = await partnerService.createApiKey(req.partner.partnerId, req.params.appId, {
    name,
    scopes: scopesList(req.body),
  });
  res.status(201).render('key', {
    title: 'API key created',
    partner: partnerService.partnerDto(req.partner),
    app: result.record ? { appId: req.params.appId } : null,
    credential: { kind: 'api-key', value: result.key },
    record: result.record,
  });
}));

app.post('/apps/:appId/keys/:keyId/revoke', sec.requirePartner(), sec.requireCsrf, page(async (req, res) => {
  await partnerService.revokeApiKey(req.partner.partnerId, req.params.keyId);
  res.redirect(`/partners/apps/${req.params.appId}`);
}));

app.post('/apps/:appId/client-secret', sec.requirePartner(), sec.requireCsrf, page(async (req, res) => {
  const result = await partnerService.rotateClientSecret(req.partner.partnerId, req.params.appId);
  res.render('key', {
    title: 'Client secret rotated',
    partner: partnerService.partnerDto(req.partner),
    app: result.app,
    credential: { kind: 'client-secret', value: result.clientSecret },
    record: null,
  });
}));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
  res.status(status).render('error', {
    title: status >= 500 ? 'Something went wrong' : 'Request failed',
    message: status >= 500 ? 'An unexpected error occurred.' : err.message,
    partner: res.locals.partner || null,
    admin: null,
  });
});

module.exports = app;
