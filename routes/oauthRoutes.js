const express = require('express');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const rateLimit = require('express-rate-limit');
const ejsLayouts = require('express-ejs-layouts');
const bcrypt = require('bcryptjs');

const PartnerApp = require('../models/PartnerApp');
const PartnerAccount = require('../models/PartnerAccount');
const SyncSpaceProfile = require('../models/SyncSpaceProfile');
const User = require('../models/userModel');
const SpaceConnection = require('../models/SpaceConnection');
const oidc = require('../services/oidcProvider');
const identity = require('../services/syncSpaceIdentity');
const connections = require('../services/syncSpaceConnections');
const sec = require('../middleware/partnerPortalSecurity');
const { normalizePhoneNumber, isValidPhoneNumber } = require('../utils/phoneUtils');
const { MANDATORY_IDENTITY_SCOPES } = require('../services/syncSpacePermissions');

const app = express();
app.disable('x-powered-by');
app.set('views', path.join(__dirname, '..', 'views', 'oauth'));
app.set('view engine', 'ejs');
app.set('view cache', process.env.NODE_ENV === 'production');
app.use(ejsLayouts);
app.set('layout', 'layout');

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
    "form-action 'self'; frame-ancestors 'none'"
  );
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'sync-space'), {
  index: false,
  maxAge: '1h',
}));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

const OAUTH_SESSION_MS = 15 * 60 * 1000;
const OAUTH_SESSION_COLLECTION = 'sync_space_oauth_sessions';
let oauthSession = null;
app.use((req, res, next) => {
  if (!oauthSession) {
    oauthSession = session({
      name: 'syncspace.oauth.sid',
      secret: (process.env.SYNC_SPACE_SESSION_SECRET || '') + ':oauth',
      resave: false,
      saveUninitialized: false,
      proxy: true,
      store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        collectionName: OAUTH_SESSION_COLLECTION,
        ttl: Math.ceil(OAUTH_SESSION_MS / 1000),
      }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: OAUTH_SESSION_MS,
        path: '/oauth',
      },
    });
  }
  return oauthSession(req, res, next);
});
app.use(sec.ensureCsrfToken);
app.use(sec.sameOriginGuard);

const isJsonEndpoint = (req) => ['/token', '/userinfo', '/revoke'].includes(req.path);

app.use((req, res, next) => {
  if (process.env.SYNC_SPACE_ENABLED === 'false') {
    if (isJsonEndpoint(req)) {
      return res.status(503).json({ error: 'temporarily_unavailable' });
    }
    return res.status(503).render('error', {
      title: 'Coming soon',
      message: 'Sign in with Syncup is not available yet.',
    });
  }
  next();
});

// ---------- helpers ---------------------------------------------------------

const page = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    if (isJsonEndpoint(req)) {
      const status = error.statusCode || (error.oauthError ? 400 : 500);
      const headers = {};
      if (error.wwwAuthenticate) {
        headers['WWW-Authenticate'] = error.bearer
          ? 'Bearer realm="syncup", error="invalid_token"'
          : 'Basic realm="syncup"';
      }
      res.set(headers);
      return res.status(status).json({
        error: error.oauthError || (status === 500 ? 'server_error' : 'invalid_request'),
      });
    }
    if (error.statusCode && error.statusCode < 500) {
      return res.status(error.statusCode).render('error', {
        title: 'Something went wrong',
        message: error.message || 'The request could not be completed.',
      });
    }
    return next(error);
  }
};

const renderError = (res, title, message, status = 400) =>
  res.status(status).render('error', { title, message });

const redirectWithError = (res, oauthReq, error, description) => {
  const params = new URLSearchParams({ error });
  if (description) params.set('error_description', description);
  if (oauthReq.state) params.set('state', oauthReq.state);
  const sep = oauthReq.redirectUri.includes('?') ? '&' : '?';
  res.redirect(`${oauthReq.redirectUri}${sep}${params}`);
};

const issueCodeAndRedirect = async (req, res, oauthReq, appDoc, userId, grantedScopes, requiredScopes) => {
  const connection = await connections.upsertConnection({
    userId,
    app: appDoc,
    scopes: grantedScopes || oauthReq.scopes,
    requiredScopes,
    merge: true,
  });
  const { code } = await oidc.issueAuthorizationCode({
    oauthRequest: oauthReq,
    userId,
    connection,
    grantedScopes: connection.scopes,
  });
  delete req.session.oauthRequest;
  const params = new URLSearchParams({ code });
  if (oauthReq.state) params.set('state', oauthReq.state);
  params.set('iss', oidc.issuer());
  const sep = oauthReq.redirectUri.includes('?') ? '&' : '?';
  res.redirect(`${oauthReq.redirectUri}${sep}${params}`);
};

// Field-level consent view model: mandatory scopes are always granted; extra
// fields are split required/optional by the app's identityFields config; each
// carries the user's sharing policy. Fields already granted on an existing
// connection show as a summary instead of new choices.
const consentViewModel = (appDoc, oauthReq, connection, profile) => {
  const policy = identity.sharingPolicyOf(profile);
  const { required, optional } = oidc.consentFields(appDoc, oauthReq.scopes);
  const granted = new Set(connection ? connection.scopes : []);
  return {
    policy,
    required: required
      .filter((s) => !granted.has(s))
      .map((scope) => ({ scope, policy: policy[scope] || 'ask' })),
    optional: optional
      .filter((s) => !granted.has(s))
      .map((scope) => ({ scope, policy: policy[scope] || 'ask' })),
    alreadyShared: [...required, ...optional].filter((s) => granted.has(s)),
  };
};

const FIELD_LABELS = {
  phone: 'your phone number',
  sync_id: 'your Sync ID',
  picture: 'your profile photo',
  birthdate: 'your date of birth',
  gender: 'your gender',
};

const consentPayload = async (oauthReq, appDoc, userId) => {
  const [profile, connection, partner, user] = await Promise.all([
    SyncSpaceProfile.findOne({ userId }).lean(),
    SpaceConnection.findOne({ userId, appId: appDoc.appId, status: 'active' }).lean(),
    PartnerAccount.findOne({ partnerId: appDoc.partnerId }).lean(),
    User.findOne({ userId }).lean(),
  ]);
  let domain = '';
  let redirectHost = '';
  try {
    domain = appDoc.website ? new URL(appDoc.website).hostname : '';
    redirectHost = new URL(oauthReq.redirectUri).hostname;
  } catch { /* empty */ }
  return {
    title: `Allow ${appDoc.name}?`,
    appDoc,
    partner,
    domain,
    redirectHost,
    fields: consentViewModel(appDoc, oauthReq, connection, profile),
    labels: FIELD_LABELS,
    offlineAccess: oauthReq.scopes.includes('offline_access'),
    noEmail: !user || !user.email,
    requestId: oauthReq.requestId,
    userId,
  };
};

const renderConsent = async (res, oauthReq, appDoc, userId, error = null) =>
  res.render('consent', { ...(await consentPayload(oauthReq, appDoc, userId)), error });

// Everything after a successful login: usability → profile → consent → code.
const continueAuthorize = async (req, res) => {
  const oauthReq = req.session.oauthRequest;
  const userId = req.session.oauthUserId;
  if (!oauthReq || !userId) {
    return renderError(res, 'Session expired', 'Start the sign-in again from the app that sent you here.');
  }
  const appDoc = await PartnerApp.findOne({ appId: oauthReq.clientId, kind: 'app' }).lean();
  if (!appDoc) {
    return renderError(res, 'Unknown app', 'This app is not registered for Sign in with Syncup.');
  }
  const unusable = await oidc.appUsable(appDoc);
  if (unusable) {
    return renderError(res, 'App unavailable', 'This app is not available for sign-in right now.', 403);
  }
  if (appDoc.environment === 'sandbox' && !(appDoc.sandboxUserIds || []).includes(userId)) {
    return renderError(res, 'Testing only', 'This app is in testing and only invited testers can sign in.', 403);
  }
  const profile = await SyncSpaceProfile.findOne({ userId }).lean();
  if (!profile) {
    return res.render('activate', { title: 'Activate Sync Space' });
  }
  if (profile.status === 'suspended') {
    return renderError(res, 'Sync Space suspended', 'Your Sync Space is suspended — sign-in is unavailable.', 403);
  }
  // Skip consent when an active connection already covers the scopes.
  const connection = await SpaceConnection.findOne({ userId, appId: appDoc.appId, status: 'active' }).lean();
  // Mandatory scopes always granted; the connection must also already cover
  // every requested extra for consent to be skipped.
  const wantScopes = [...new Set([...oauthReq.scopes, ...MANDATORY_IDENTITY_SCOPES])];
  const granted = connection ? wantScopes.every((s) => connection.scopes.includes(s)) : false;
  if (granted && oauthReq.prompt !== 'consent') {
    return issueCodeAndRedirect(req, res, oauthReq, appDoc, userId, connection.scopes);
  }
  if (oauthReq.prompt === 'none') {
    return redirectWithError(res, oauthReq, 'consent_required', 'User consent is required');
  }
  return renderConsent(res, oauthReq, appDoc, userId);
};

const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => renderError(res, 'Too many attempts', 'Too many attempts, please try again later.', 429),
});
const loginPhoneLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const phone = req.body && req.body.phoneNumber;
    return typeof phone === 'string' && isValidPhoneNumber(phone)
      ? normalizePhoneNumber(phone)
      : req.ip;
  },
  handler: (req, res) => renderError(res, 'Too many attempts', 'Too many attempts, please try again later.', 429),
});

// ---------- discovery / JWKS (publicly cacheable) ----------------------------

app.get('/.well-known/openid-configuration', page(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(oidc.discovery());
}));

app.get('/jwks', page(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(oidc.jwks());
}));

// ---------- authorize --------------------------------------------------------

app.get('/authorize', page(async (req, res) => {
  const q = req.query;
  const clientId = typeof q.client_id === 'string' ? q.client_id : '';
  const appDoc = clientId
    ? await PartnerApp.findOne({ appId: clientId, kind: 'app' }).lean()
    : null;
  if (!appDoc) {
    return renderError(res, 'Unknown app', 'This app is not registered for Sign in with Syncup.');
  }
  const redirectUri = typeof q.redirect_uri === 'string' ? q.redirect_uri : '';
  if (!redirectUri || !appDoc.redirectUris.includes(redirectUri)) {
    return renderError(res, 'Invalid redirect', 'This app sent an unregistered redirect URI.');
  }
  const oauthReq = {
    requestId: `oar_${crypto.randomBytes(12).toString('hex')}`,
    clientId: appDoc.appId,
    redirectUri,
    state: typeof q.state === 'string' ? q.state : '',
    nonce: typeof q.nonce === 'string' && q.nonce.length <= 500 ? q.nonce : null,
    prompt: typeof q.prompt === 'string' ? q.prompt : null,
  };
  if (q.response_type !== 'code') {
    return redirectWithError(res, oauthReq, 'unsupported_response_type', 'Only response_type=code is supported');
  }
  if (!oauthReq.state || oauthReq.state.length > 500) {
    return redirectWithError(res, oauthReq, 'invalid_request', 'state is required (max 500 chars)');
  }
  const scopes = String(q.scope || '').split(' ').filter(Boolean);
  if (!scopes.includes('openid') || !oidc.oauthScopes(scopes, appDoc.requestedScopes)) {
    return redirectWithError(res, oauthReq, 'invalid_scope', 'Requested scopes are not allowed');
  }
  if (!oidc.extraScopesAllowed(appDoc, scopes)) {
    return redirectWithError(res, oauthReq, 'invalid_scope', 'The app does not request that data');
  }
  oauthReq.scopes = scopes;
  if (typeof q.code_challenge !== 'string' || !oidc.PKCE_CHALLENGE.test(q.code_challenge) ||
      q.code_challenge_method !== 'S256') {
    return redirectWithError(res, oauthReq, 'invalid_request', 'PKCE (S256) is required');
  }
  oauthReq.codeChallenge = q.code_challenge;
  if (oauthReq.prompt && !['none', 'login', 'consent'].includes(oauthReq.prompt)) {
    return redirectWithError(res, oauthReq, 'invalid_request', 'Unknown prompt value');
  }

  req.session.oauthRequest = oauthReq;
  if (req.session.oauthUserId && oauthReq.prompt !== 'login') {
    return continueAuthorize(req, res);
  }
  if (oauthReq.prompt === 'none') {
    delete req.session.oauthRequest;
    return redirectWithError(res, oauthReq, 'login_required', 'User authentication is required');
  }
  return res.redirect('/oauth/login');
}));

// ---------- login ------------------------------------------------------------

const requireOauthRequest = (req, res, next) => {
  if (!req.session || !req.session.oauthRequest) {
    return renderError(res, 'Session expired', 'Start the sign-in again from the app that sent you here.');
  }
  next();
};

app.get('/login', requireOauthRequest, page(async (req, res) => {
  if (req.query && req.query.switch) delete req.session.oauthUserId;
  res.render('login', {
    title: 'Sign in with Syncup',
    error: null,
    prompt: req.session.oauthRequest.prompt,
  });
}));

app.post(
  '/login',
  requireOauthRequest,
  sec.requireCsrf,
  loginIpLimiter,
  loginPhoneLimiter,
  page(async (req, res) => {
    const { phoneNumber, password } = req.body || {};
    const fail = () =>
      res.status(401).render('login', {
        title: 'Sign in with Syncup',
        error: 'Phone or password is incorrect',
        prompt: req.session.oauthRequest.prompt,
      });
    if (typeof phoneNumber !== 'string' || !isValidPhoneNumber(phoneNumber) ||
        typeof password !== 'string' || password.length === 0) {
      return fail();
    }
    const user = await User.findOne({ phoneNumber: normalizePhoneNumber(phoneNumber) }).select('+password');
    if (!user) return fail();
    const match = await bcrypt.compare(password, user.password || '');
    if (!match) return fail();

    const oauthReq = req.session.oauthRequest;
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.oauthRequest = oauthReq;
    req.session.csrfToken = sec.newCsrfToken();
    req.session.oauthUserId = user.userId;
    req.session.oauthAuthTime = new Date().toISOString();
    res.redirect('/oauth/consent');
  })
);

app.post('/activate', requireOauthRequest, sec.requireCsrf, page(async (req, res) => {
  if (!req.session.oauthUserId) return res.redirect('/oauth/login');
  await identity.activateProfile(req.session.oauthUserId);
  res.redirect('/oauth/consent');
}));

// ---------- consent ----------------------------------------------------------

app.get('/consent', requireOauthRequest, page(async (req, res) => {
  if (!req.session.oauthUserId) return res.redirect('/oauth/login');
  return continueAuthorize(req, res);
}));

app.post('/consent', requireOauthRequest, sec.requireCsrf, page(async (req, res) => {
  const oauthReq = req.session.oauthRequest;
  const userId = req.session.oauthUserId;
  if (!userId) return res.redirect('/oauth/login');
  const body = req.body || {};
  if (body.decision !== 'approve') {
    const out = redirectWithError(res, oauthReq, 'access_denied', 'The user denied access');
    delete req.session.oauthRequest;
    return out;
  }
  const appDoc = await PartnerApp.findOne({ appId: oauthReq.clientId, kind: 'app' }).lean();
  if (!appDoc) return renderError(res, 'Unknown app', 'This app is not registered for Sign in with Syncup.');
  const unusable = await oidc.appUsable(appDoc);
  if (unusable) return renderError(res, 'App unavailable', 'This app is not available for sign-in right now.', 403);
  if (appDoc.environment === 'sandbox' && !(appDoc.sandboxUserIds || []).includes(userId)) {
    return renderError(res, 'Testing only', 'This app is in testing and only invited testers can sign in.', 403);
  }
  const [profile, user] = await Promise.all([
    SyncSpaceProfile.findOne({ userId }).lean(),
    User.findOne({ userId }).lean(),
  ]);
  if (!profile || profile.status === 'suspended') {
    return renderError(res, 'Sync Space unavailable', 'Sync Space is not available for this account.', 403);
  }
  if (!user || !user.email) {
    return res.status(400).render('error', {
      title: 'Email required',
      message: 'Add an email to your Syncup account to sign in to apps.',
    });
  }

  // Recompute the grant server-side — never trust submitted field names.
  const { required, optional } = oidc.consentFields(appDoc, oauthReq.scopes);
  const policy = identity.sharingPolicyOf(profile);
  const chosen = new Set(
    [].concat(body.fields || []).filter((s) => typeof s === 'string' && optional.includes(s)),
  );
  // Required fields whose global policy is 'never' need the explicit
  // share-once override checkbox.
  const gated = required.filter((s) => policy[s] === 'never');
  const missing = gated.filter(
    (s) => body[`share_once_${s}`] !== 'on' && body[`share_once_${s}`] !== s,
  );
  if (missing.length > 0) {
    return res.status(400).render('consent', {
      ...(await consentPayload(oauthReq, appDoc, userId)),
      error: `${appDoc.name} needs ${missing.map((s) => FIELD_LABELS[s] || s).join(', ')} — check "Share once" to continue.`,
    });
  }
  // Non-extra identity scopes (offline_access) are granted unchanged.
  const extras = new Set(['phone', 'sync_id', 'picture', 'birthdate', 'gender']);
  const otherIdentity = oauthReq.scopes.filter(
    (s) => !extras.has(s) && !MANDATORY_IDENTITY_SCOPES.includes(s),
  );
  const granted = [
    ...new Set([...MANDATORY_IDENTITY_SCOPES, ...required, ...chosen, ...otherIdentity]),
  ];
  const requiredSnapshot = [...new Set([...MANDATORY_IDENTITY_SCOPES, ...required])];
  return issueCodeAndRedirect(req, res, oauthReq, appDoc, userId, granted, requiredSnapshot);
}));

// ---------- token / userinfo / revoke (JSON) ---------------------------------

app.post('/token', page(async (req, res) => {
  const appDoc = await oidc.authenticateClient(req);
  const { grant_type } = req.body || {};
  let result;
  if (grant_type === 'authorization_code') {
    result = await oidc.exchangeCode(appDoc, req.body || {});
  } else if (grant_type === 'refresh_token') {
    result = await oidc.exchangeRefreshToken(appDoc, req.body || {});
  } else {
    const err = new Error('unsupported_grant_type');
    err.oauthError = 'unsupported_grant_type';
    err.statusCode = 400;
    throw err;
  }
  const payload = {
    access_token: result.accessToken,
    token_type: result.tokenType,
    expires_in: result.expiresIn,
    id_token: result.idToken,
    scope: result.scope,
  };
  if (result.refreshToken) payload.refresh_token = result.refreshToken;
  res.json(payload);
}));

const userinfo = page(async (req, res) => {
  const claims = await oidc.bearerUserinfo(req);
  res.json(claims);
});
app.get('/userinfo', userinfo);
app.post('/userinfo', userinfo);

app.post('/revoke', page(async (req, res) => {
  const appDoc = await oidc.authenticateClient(req);
  await oidc.revokeToken(appDoc, req.body && req.body.token);
  res.status(200).end();
}));

app.use((req, res) => {
  if (isJsonEndpoint(req)) return res.status(404).json({ error: 'invalid_request' });
  return renderError(res, 'Not found', 'This page does not exist.', 404);
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('❌ [OAUTH] Error:', error.message);
  if (isJsonEndpoint(req)) {
    return res.status(error.statusCode || 500).json({ error: 'server_error' });
  }
  const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
  return renderError(
    res,
    'Something went wrong',
    status === 500 ? 'An unexpected error occurred.' : error.message,
    status
  );
});

module.exports = app;
// For tests — clear in-memory login limiter windows between cases.
module.exports.resetLoginLimits = (ips = [], phones = []) => {
  ips.forEach((ip) => loginIpLimiter.resetKey(ip));
  phones.forEach((p) => loginPhoneLimiter.resetKey(p));
};
