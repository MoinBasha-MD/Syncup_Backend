const crypto = require('crypto');
const PartnerApp = require('../models/PartnerApp');
const PartnerAccount = require('../models/PartnerAccount');
const SpaceConnection = require('../models/SpaceConnection');
const OAuthAuthorizationCode = require('../models/OAuthAuthorizationCode');
const OAuthAccessToken = require('../models/OAuthAccessToken');
const OAuthRefreshToken = require('../models/OAuthRefreshToken');
const User = require('../models/userModel');
const SyncSpaceProfile = require('../models/SyncSpaceProfile');
const { pairwiseSubject, digestSecret, decryptSecret } = require('../utils/syncSpaceCrypto');
const {
  IDENTITY_SCOPES,
  MANDATORY_IDENTITY_SCOPES,
  EXTRA_IDENTITY_SCOPES,
} = require('./syncSpacePermissions');
const { ServiceUnavailableError, BadRequestError } = require('../utils/errorClasses');

const CODE_TTL_MS = 60 * 1000;
const TOKEN_TTL_S = 3600;
const ID_TOKEN_TTL_S = 600;
const REFRESH_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_FAMILY_MS = 90 * 24 * 60 * 60 * 1000;

const issuer = () => {
  const value = (process.env.SYNC_SPACE_OIDC_ISSUER || '').replace(/\/+$/, '');
  if (!value) throw new ServiceUnavailableError('Sync Space sign-in is not configured');
  if (process.env.NODE_ENV === 'production' && !value.startsWith('https://')) {
    throw new ServiceUnavailableError('OIDC issuer must be https');
  }
  return value;
};

let cachedKey = null;
const signingKey = () => {
  if (cachedKey === null) {
    const pem = process.env.SYNC_SPACE_OIDC_PRIVATE_KEY;
    cachedKey = false;
    if (pem) {
      try {
        const privateKey = crypto.createPrivateKey(pem.replace(/\\n/g, '\n'));
        const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
        const kid = crypto
          .createHash('sha256')
          .update(`{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`)
          .digest('base64url');
        cachedKey = { privateKey, jwk, kid };
      } catch {
        cachedKey = false;
      }
    }
  }
  if (!cachedKey) throw new ServiceUnavailableError('Sync Space sign-in is not configured');
  return cachedKey;
};

// for tests
const resetKeyCache = () => { cachedKey = null; };

const jwks = () => {
  const { jwk, kid } = signingKey();
  return { keys: [{ ...jwk, kid, alg: 'ES256', use: 'sig' }] };
};

const discovery = () => {
  const iss = issuer();
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/authorize`,
    token_endpoint: `${iss}/token`,
    userinfo_endpoint: `${iss}/userinfo`,
    jwks_uri: `${iss}/jwks`,
    revocation_endpoint: `${iss}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['pairwise'],
    id_token_signing_alg_values_supported: ['ES256'],
    scopes_supported: IDENTITY_SCOPES,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: [
      'sub', 'iss', 'aud', 'azp', 'exp', 'iat', 'auth_time', 'nonce',
      'name', 'preferred_username', 'email', 'email_verified', 'phone_number', 'sync_id',
      'picture', 'birthdate', 'gender',
    ],
  };
};

const base64url = (buf) => Buffer.from(buf).toString('base64url');

// Claims shared by the ID token and /userinfo.
// email_verified: registration verifies email via OTP grant → flag exists.
// phone_number_verified: registration does NOT verify phone → claim omitted.
const claimsFor = (user, profile, scopes, subject) => {
  const claims = { sub: subject };
  if (scopes.includes('profile')) {
    claims.name = user.name;
    claims.preferred_username = user.username;
  }
  if (scopes.includes('email') && user.email) {
    claims.email = user.email;
    claims.email_verified = user.emailVerified === true;
  }
  if (scopes.includes('phone') && user.phoneNumber) {
    claims.phone_number = user.phoneNumber;
  }
  if (scopes.includes('sync_id') && profile) {
    claims.sync_id = profile.syncId;
  }
  // picture: only plain public URLs — an encrypted profile image is never
  // decrypted or served to partners.
  if (
    scopes.includes('picture') &&
    typeof user.profileImage === 'string' &&
    user.profileImageEncrypted !== true &&
    /^https?:\/\//.test(user.profileImage)
  ) {
    claims.picture = user.profileImage;
  }
  if (scopes.includes('birthdate') && user.dateOfBirth) {
    const dob = new Date(user.dateOfBirth);
    if (!Number.isNaN(dob.getTime())) claims.birthdate = dob.toISOString().slice(0, 10);
  }
  if (scopes.includes('gender') && user.gender) {
    claims.gender = user.gender;
  }
  return claims;
};

// Consent-screen model: which extra fields an app may ask for, split into
// required (from app identityFields config) vs optional — legacy apps with no
// config treat every requested extra as optional.
const consentFields = (appDoc, requestedScopes) => {
  const extras = requestedScopes.filter((s) => EXTRA_IDENTITY_SCOPES.includes(s));
  const configured = Array.isArray(appDoc.identityFields) ? appDoc.identityFields : [];
  const requiredSet = new Set(
    configured.filter((f) => f && f.required === true).map((f) => f.scope),
  );
  return {
    extras,
    required: extras.filter((s) => requiredSet.has(s)),
    optional: extras.filter((s) => !requiredSet.has(s)),
  };
};

// At authorize time an app may only request extras it configured — unless it
// has no identityFields at all (legacy apps: everything optional).
const extraScopesAllowed = (appDoc, requestedScopes) => {
  const configured = Array.isArray(appDoc.identityFields) ? appDoc.identityFields : [];
  if (configured.length === 0) return true;
  const allowed = new Set(configured.map((f) => f && f.scope));
  return requestedScopes
    .filter((s) => EXTRA_IDENTITY_SCOPES.includes(s))
    .every((s) => allowed.has(s));
};

const signIdToken = ({ user, profile, scopes, appId, nonce, authTime }) => {
  const { privateKey, kid } = signingKey();
  const iss = issuer();
  const subject = pairwiseSubject(appId, user.userId);
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss,
    sub: subject,
    aud: appId,
    azp: appId,
    exp: iat + ID_TOKEN_TTL_S,
    iat,
    auth_time: Math.floor(new Date(authTime).getTime() / 1000),
    ...claimsFor(user, profile, scopes, subject),
  };
  if (nonce) claims.nonce = nonce;
  const header = { alg: 'ES256', typ: 'JWT', kid };
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('sha256', data, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return { idToken: `${data}.${base64url(signature)}`, subject };
};

const oauthScopes = (requested, appRequested) => {
  const allowed = new Set((appRequested || []).filter((s) => IDENTITY_SCOPES.includes(s)));
  return requested.every((s) => allowed.has(s)) ? requested : null;
};

const appUsable = async (app) => {
  const partner = await PartnerAccount.findOne({ partnerId: app.partnerId }).lean();
  if (!partner || partner.approvalStatus === 'suspended') return 'suspended';
  if (app.status !== 'active') return 'disabled';
  if (app.environment === 'live' && partner.approvalStatus !== 'approved') return 'unapproved';
  return null;
};

const issueAuthorizationCode = async ({ oauthRequest, userId, connection, grantedScopes }) => {
  const code = `occ_${crypto.randomBytes(32).toString('base64url')}`;
  const authTime = new Date();
  await OAuthAuthorizationCode.create({
    codeHash: digestSecret(code),
    appId: oauthRequest.clientId,
    userId,
    connectionId: connection.connectionId,
    consentVersion: connection.consentVersion,
    redirectUri: oauthRequest.redirectUri,
    scopes: grantedScopes || oauthRequest.scopes,
    nonce: oauthRequest.nonce || null,
    codeChallenge: oauthRequest.codeChallenge,
    authTime,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return { code, authTime };
};

// Client authentication shared by /token and /revoke. Returns the app doc or
// throws an error carrying { oauthError, status, wwwAuthenticate }.
const authenticateClient = async (req) => {
  const basic = (() => {
    const header = req.headers && req.headers.authorization;
    if (!header || !header.startsWith('Basic ')) return null;
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx === -1) return { clientId: decoded, secret: '' };
      return {
        clientId: decodeURIComponent(decoded.slice(0, idx)),
        secret: decodeURIComponent(decoded.slice(idx + 1)),
      };
    } catch {
      return { malformed: true };
    }
  })();
  const body = req.body || {};
  if (basic && basic.malformed) {
    const err = new BadRequestError('invalid_client');
    err.oauthError = 'invalid_client';
    err.wwwAuthenticate = true;
    throw err;
  }
  if (basic && (body.client_secret || body.client_id)) {
    const err = new BadRequestError('invalid_request');
    err.oauthError = 'invalid_request';
    throw err;
  }
  const clientId = basic ? basic.clientId : body.client_id;
  const secret = basic ? basic.secret : body.client_secret;
  if (typeof clientId !== 'string' || !/^sp_[a-f0-9]{32}$/.test(clientId)) {
    const err = new BadRequestError('invalid_client');
    err.oauthError = 'invalid_client';
    err.wwwAuthenticate = true;
    err.statusCode = 401;
    throw err;
  }
  const app = await PartnerApp.findOne({ appId: clientId }).select('+clientSecretEncrypted');
  if (!app || app.kind !== 'app' || app.status !== 'active') {
    const err = new BadRequestError('invalid_client');
    err.oauthError = 'invalid_client';
    err.wwwAuthenticate = true;
    err.statusCode = 401;
    throw err;
  }
  if (app.applicationType === 'web') {
    if (!secret || !app.clientSecretEncrypted) {
      const err = new BadRequestError('invalid_client');
      err.oauthError = 'invalid_client';
      err.wwwAuthenticate = true;
      err.statusCode = 401;
      throw err;
    }
    const expected = decryptSecret(app.clientSecretEncrypted, `client:${clientId}`);
    const a = Buffer.from(String(secret));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      const err = new BadRequestError('invalid_client');
      err.oauthError = 'invalid_client';
      err.wwwAuthenticate = true;
      err.statusCode = 401;
      throw err;
    }
  } else if (secret) {
    // public clients must not send a secret
    const err = new BadRequestError('invalid_client');
    err.oauthError = 'invalid_client';
    err.wwwAuthenticate = true;
    err.statusCode = 401;
    throw err;
  }
  return app;
};

const sha256B64url = (value) => crypto.createHash('sha256').update(value).digest('base64url');

const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;

// Exchange an authorization code. Throws { oauthError } failures.
const exchangeCode = async (app, body) => {
  const { code, redirect_uri, code_verifier } = body;
  if (typeof code !== 'string' || !code || typeof redirect_uri !== 'string' ||
      typeof code_verifier !== 'string' || !PKCE_VERIFIER.test(code_verifier)) {
    const err = new BadRequestError('invalid_grant');
    err.oauthError = 'invalid_grant';
    throw err;
  }
  const hash = digestSecret(code);
  const now = new Date();
  // Reserve the token id up front and record it inside the same atomic consume
  // so a replay that lands between consume and token creation can still revoke
  // the eventual token.
  const tokenId = `satid_${crypto.randomBytes(12).toString('hex')}`;
  // Atomic consume bound to THIS client — a leaked code can't be burned by a
  // different client, and a foreign consumed code revokes nothing of ours.
  const authCode = await OAuthAuthorizationCode.findOneAndUpdate(
    { codeHash: hash, appId: app.appId, consumedAt: null },
    { $set: { consumedAt: now }, $push: { issuedTokenIds: tokenId } },
    { new: true }
  );
  if (!authCode) {
    // Replay of a consumed code belonging to this client → revoke its tokens.
    const consumed = await OAuthAuthorizationCode.findOne({ codeHash: hash }).lean();
    if (consumed && consumed.appId === app.appId && consumed.consumedAt &&
        consumed.issuedTokenIds && consumed.issuedTokenIds.length) {
      await OAuthAccessToken.updateMany(
        { tokenId: { $in: consumed.issuedTokenIds }, revokedAt: null },
        { $set: { revokedAt: now } }
      );
    }
    const err = new BadRequestError('invalid_grant');
    err.oauthError = 'invalid_grant';
    throw err;
  }
  const fail = async () => {
    const err = new BadRequestError('invalid_grant');
    err.oauthError = 'invalid_grant';
    throw err;
  };
  if (authCode.expiresAt < now) await fail();
  if (authCode.redirectUri !== redirect_uri) await fail();
  if (sha256B64url(code_verifier) !== authCode.codeChallenge) await fail();

  const connection = await SpaceConnection.findOne({ connectionId: authCode.connectionId }).lean();
  if (!connection || connection.status !== 'active' ||
      connection.consentVersion !== authCode.consentVersion) {
    await fail();
  }
  const user = await User.findOne({ userId: authCode.userId }).lean();
  if (!user) await fail();
  const profile = await SyncSpaceProfile.findOne({ userId: authCode.userId }).lean();
  if (!profile || profile.status !== 'active') await fail();
  if (await appUsable(app)) await fail();

  const familyId = authCode.scopes.includes('offline_access')
    ? `fam_${crypto.randomBytes(16).toString('hex')}`
    : null;
  const rawToken = `sat_${crypto.randomBytes(32).toString('base64url')}`;
  await OAuthAccessToken.create({
    tokenId,
    tokenHash: digestSecret(rawToken),
    appId: app.appId,
    userId: authCode.userId,
    connectionId: authCode.connectionId,
    consentVersion: authCode.consentVersion,
    scopes: authCode.scopes,
    familyId,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_S * 1000),
  });

  let refreshToken = null;
  if (familyId) {
    const rawRefresh = `srt_${crypto.randomBytes(32).toString('base64url')}`;
    await OAuthRefreshToken.create({
      tokenId: `srtid_${crypto.randomBytes(12).toString('hex')}`,
      tokenHash: digestSecret(rawRefresh),
      familyId,
      appId: app.appId,
      userId: authCode.userId,
      connectionId: authCode.connectionId,
      consentVersion: authCode.consentVersion,
      scopes: authCode.scopes,
      expiresAt: new Date(now.getTime() + REFRESH_IDLE_MS),
      familyExpiresAt: new Date(now.getTime() + REFRESH_FAMILY_MS),
    });
    refreshToken = rawRefresh;
  }

  const { idToken } = signIdToken({
    user, profile, scopes: authCode.scopes, appId: app.appId,
    nonce: authCode.nonce, authTime: authCode.authTime,
  });
  return {
    accessToken: rawToken,
    tokenType: 'Bearer',
    expiresIn: TOKEN_TTL_S,
    idToken,
    refreshToken,
    scope: authCode.scopes.join(' '),
  };
};

// grant_type=refresh_token — rotate inside the same family; reuse revokes it.
const exchangeRefreshToken = async (app, body) => {
  const { refresh_token } = body || {};
  const invalid = (error = 'invalid_grant') => {
    const err = new BadRequestError(error);
    err.oauthError = error;
    throw err;
  };
  if (typeof refresh_token !== 'string' || !refresh_token) invalid();
  const hash = digestSecret(refresh_token);
  const now = new Date();
  const revokeFamily = async (familyId) => {
    await OAuthRefreshToken.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt: now } }
    );
    await OAuthAccessToken.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt: now } }
    );
  };
  // Read first: request-level mistakes (wrong client, widening scope) must not
  // burn the token; only a genuinely-used token reuse revokes the family.
  const existing = await OAuthRefreshToken.findOne({ tokenHash: hash }).lean();
  if (!existing || existing.appId !== app.appId) invalid();
  if (existing.usedAt || existing.revokedAt) {
    await revokeFamily(existing.familyId);
    invalid();
  }
  if (existing.expiresAt <= now || existing.familyExpiresAt <= now) invalid();

  // scope on refresh may only narrow — checked before the atomic claim
  const narrowed = typeof body.scope === 'string' && body.scope.trim()
    ? body.scope.split(' ').filter(Boolean)
    : existing.scopes;
  if (!narrowed.length || !narrowed.every((s) => existing.scopes.includes(s))) {
    invalid('invalid_scope');
  }

  // Atomic mark-used — single winner on concurrent rotations.
  const used = await OAuthRefreshToken.findOneAndUpdate(
    { tokenHash: hash, appId: app.appId, usedAt: null, revokedAt: null },
    { $set: { usedAt: now } },
    { new: true }
  );
  if (!used) {
    await revokeFamily(existing.familyId);
    invalid();
  }

  const connection = await SpaceConnection.findOne({ connectionId: used.connectionId }).lean();
  if (!connection || connection.status !== 'active' ||
      connection.consentVersion !== used.consentVersion) invalid();
  const user = await User.findOne({ userId: used.userId }).lean();
  if (!user) invalid();
  const profile = await SyncSpaceProfile.findOne({ userId: used.userId }).lean();
  if (!profile || profile.status !== 'active') invalid();
  if (await appUsable(app)) invalid();

  const tokenId = `satid_${crypto.randomBytes(12).toString('hex')}`;
  const rawToken = `sat_${crypto.randomBytes(32).toString('base64url')}`;
  await OAuthAccessToken.create({
    tokenId,
    tokenHash: digestSecret(rawToken),
    appId: app.appId,
    userId: used.userId,
    connectionId: used.connectionId,
    consentVersion: used.consentVersion,
    scopes: narrowed,
    familyId: used.familyId,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_S * 1000),
  });
  const rawRefresh = `srt_${crypto.randomBytes(32).toString('base64url')}`;
  await OAuthRefreshToken.create({
    tokenId: `srtid_${crypto.randomBytes(12).toString('hex')}`,
    tokenHash: digestSecret(rawRefresh),
    familyId: used.familyId,
    appId: app.appId,
    userId: used.userId,
    connectionId: used.connectionId,
    consentVersion: used.consentVersion,
    scopes: narrowed,
    expiresAt: new Date(Math.min(now.getTime() + REFRESH_IDLE_MS, new Date(used.familyExpiresAt).getTime())),
    familyExpiresAt: used.familyExpiresAt,
  });
  const { idToken } = signIdToken({
    user, profile, scopes: narrowed, appId: app.appId, nonce: null, authTime: now,
  });
  return {
    accessToken: rawToken,
    tokenType: 'Bearer',
    expiresIn: TOKEN_TTL_S,
    idToken,
    refreshToken: rawRefresh,
    scope: narrowed.join(' '),
  };
};

const bearerUserinfo = async (req) => {
  const header = req.headers && req.headers.authorization;
  const invalid = () => {
    const err = new BadRequestError('invalid_token');
    err.oauthError = 'invalid_token';
    err.statusCode = 401;
    err.wwwAuthenticate = true;
    err.bearer = true;
    throw err;
  };
  if (!header || !header.startsWith('Bearer ')) invalid();
  const token = await OAuthAccessToken.findOne({ tokenHash: digestSecret(header.slice(7)) });
  if (!token || token.revokedAt || token.expiresAt <= new Date()) invalid();
  const connection = await SpaceConnection.findOne({ connectionId: token.connectionId }).lean();
  if (!connection || connection.status !== 'active' ||
      connection.consentVersion !== token.consentVersion ||
      !token.scopes.every((s) => connection.scopes.includes(s))) {
    invalid();
  }
  const user = await User.findOne({ userId: token.userId }).lean();
  if (!user) invalid();
  const profile = await SyncSpaceProfile.findOne({ userId: token.userId }).lean();
  if (!profile || profile.status !== 'active') invalid();
  const app = await PartnerApp.findOne({ appId: token.appId }).lean();
  if (!app || (await appUsable(app))) invalid();
  const subject = pairwiseSubject(token.appId, token.userId);
  return claimsFor(user, profile, token.scopes, subject);
};

const revokeToken = async (app, tokenValue) => {
  if (typeof tokenValue !== 'string' || !tokenValue) return;
  const hash = digestSecret(tokenValue);
  const now = new Date();
  await OAuthAccessToken.updateMany(
    { tokenHash: hash, appId: app.appId, revokedAt: null },
    { $set: { revokedAt: now } }
  );
  // If it was a refresh token, the whole family (and its access tokens) die.
  const refresh = await OAuthRefreshToken.findOne({ tokenHash: hash, appId: app.appId }).lean();
  if (refresh) {
    await OAuthRefreshToken.updateMany(
      { familyId: refresh.familyId, revokedAt: null },
      { $set: { revokedAt: now } }
    );
    await OAuthAccessToken.updateMany(
      { familyId: refresh.familyId, revokedAt: null },
      { $set: { revokedAt: now } }
    );
  }
};

module.exports = {
  issuer,
  signingKey,
  resetKeyCache,
  jwks,
  discovery,
  claimsFor,
  signIdToken,
  oauthScopes,
  consentFields,
  extraScopesAllowed,
  appUsable,
  issueAuthorizationCode,
  authenticateClient,
  exchangeCode,
  exchangeRefreshToken,
  bearerUserinfo,
  revokeToken,
  PKCE_VERIFIER,
  PKCE_CHALLENGE,
};
