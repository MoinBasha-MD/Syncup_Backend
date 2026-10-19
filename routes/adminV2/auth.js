const express = require('express');
const jwt = require('jsonwebtoken');
const { TOTP, NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateSync, verifySync, generateURI } = require('otplib');
const Admin = require('../../models/Admin');
const AdminSession = require('../../models/AdminSession');
const { getAdminJwtSecret, ADMIN_JWT_AUDIENCE } = require('../../config/adminSecrets');
const { effectivePermissions } = require('../../config/adminPermissions');
const { encrypt, decrypt, sha256hex, randomToken, base32Token, generateRecoveryCodes, verifyDeviceSignature } = require('../../utils/adminCrypto');
const { ok, fail, handle } = require('../../utils/adminV2Response');
const { requireAdminV2 } = require('../../middleware/adminV2Auth');
const { authLimiter, adminMfaLimiter, adminSessionLimiter } = require('../../middleware/rateLimiter');
const { recordAdminAction } = require('../../services/adminAudit');

const router = express.Router();

const totp = new TOTP({ crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });

const MFA_AUDIENCE = 'syncup-admin-mfa';
const STEPUP_AUDIENCE = 'syncup-admin-stepup';
const CHALLENGE_AUDIENCE = 'syncup-admin-challenge';

const ACCESS_TTL = '10m';
const MFA_TTL = '5m';
const STEPUP_TTL = '5m';
const CHALLENGE_TTL = '2m';
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const sign = (payload, audience, expiresIn) =>
  jwt.sign(payload, getAdminJwtSecret(), { audience, expiresIn });

const signAccess = (admin, session) =>
  sign(
    { sub: String(admin._id), tv: admin.tokenVersion || 0, did: session.deviceId, sid: String(session._id), typ: 'admin_access' },
    ADMIN_JWT_AUDIENCE,
    ACCESS_TTL
  );

/**
 * Verify a TOTP and report which 30s step matched, so callers can reject
 * replays within the ±1-step window (totp.lastUsedStep).
 */
const verifyTotp = (secret, token) => {
  try {
    const r = verifySync({ secret, token, period: 30, digits: 6, window: 1 });
    return r.valid === true ? { valid: true, step: r.timeStep + r.delta } : { valid: false };
  } catch {
    return { valid: false };
  }
};

/**
 * TOTP check with replay protection + shared brute-force lockout.
 * Returns null on success, or {status, code, message} to fail with.
 * The caller must await admin.save() / persist lastUsedStep before responding.
 */
const checkTotp = async (admin, secretEnc, code) => {
  const secret = secretEnc ? decrypt(secretEnc) : null;
  const result = secret ? verifyTotp(secret, code.trim()) : { valid: false };
  const lastUsedStep = admin.totp?.lastUsedStep ?? -1;
  if (!result.valid || result.step <= lastUsedStep) {
    await admin.incLoginAttempts();
    return { status: 401, code: 'INVALID_MFA_CODE', message: 'Invalid authenticator code' };
  }
  admin.totp.lastUsedStep = result.step;
  return null;
};

const createSession = async (admin, deviceId, req) => {
  const refreshToken = randomToken(48);
  const session = await AdminSession.create({
    adminId: admin._id,
    deviceId,
    familyId: randomToken(16),
    refreshHash: sha256hex(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    ip: req.ip,
    ua: req.headers['user-agent'],
  });
  return { session, refreshToken };
};

const auditAuth = (req, admin, action, extra = {}) => {
  recordAdminAction({
    adminId: admin?._id,
    adminUsername: admin?.username,
    adminRole: admin?.role,
    deviceId: req.body?.deviceId,
    ip: req.ip,
    action,
    ...extra,
  }).catch(error => console.error(`❌ [AUDIT] Failed to record ${action}:`, error.message));
};

const emitAdminEvent = (name, payload) => {
  try {
    require('../../services/adminSocket').emitAdminEvent(name, payload);
  } catch (error) {
    console.error(`❌ [ADMIN SOCKET] Failed to emit ${name}:`, error.message);
  }
};

const adminProfile = (admin) => ({
  id: admin._id,
  username: admin.username,
  email: admin.email,
  role: admin.role,
  permissions: effectivePermissions(admin),
});

/**
 * POST /auth/login — password check; returns a short-lived mfaTicket + nonce.
 */
router.post('/login', authLimiter, handle(async (req, res) => {
  const { username, password } = req.body || {};
  const invalidCredentials = () => fail(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password');

  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return invalidCredentials();
  }

  const admin = await Admin.findOne({ username: username.toLowerCase().trim() })
    .select('+totp.secretEnc +totp.recoveryCodes');
  if (!admin) return invalidCredentials();

  if (admin.isLocked()) {
    const minutes = Math.ceil((admin.lockUntil - Date.now()) / 60000);
    return fail(res, 423, 'ACCOUNT_LOCKED', `Account locked. Try again in ${minutes} minutes.`);
  }
  if (!admin.isActive) {
    return fail(res, 403, 'ACCOUNT_DISABLED', 'Account is deactivated');
  }

  const isMatch = await admin.comparePassword(password);
  if (!isMatch) {
    await admin.incLoginAttempts();
    return invalidCredentials();
  }

  // loginAttempts are only reset after MFA succeeds (shared brute-force
  // counter — see /auth/mfa). Resetting here would let an attacker with the
  // password retry MFA codes forever, one ticket at a time.

  const nonce = randomToken(16);
  const mfaTicket = sign({ sub: String(admin._id), nonce }, MFA_AUDIENCE, MFA_TTL);

  return ok(res, { mfaTicket, nonce, totpEnrolled: admin.totp?.enabled === true });
}));

/**
 * POST /auth/totp/enroll — start TOTP enrollment (only when not enrolled yet).
 */
router.post('/totp/enroll', adminMfaLimiter, handle(async (req, res) => {
  const { mfaTicket } = req.body || {};
  let decoded;
  try {
    decoded = jwt.verify(mfaTicket, getAdminJwtSecret(), { audience: MFA_AUDIENCE });
  } catch {
    return fail(res, 401, 'MFA_TICKET_INVALID', 'Invalid or expired mfaTicket');
  }

  const admin = await Admin.findById(decoded.sub).select('+totp.secretEnc +totp.pendingSecretEnc');
  if (!admin || !admin.isActive) return fail(res, 401, 'MFA_TICKET_INVALID', 'Invalid or expired mfaTicket');
  if (admin.totp?.enabled) {
    return fail(res, 409, 'TOTP_ALREADY_ENROLLED', 'TOTP is already enrolled');
  }

  const secret = generateSecret();
  if (!admin.totp) admin.totp = {};
  admin.totp.pendingSecretEnc = encrypt(secret);
  await admin.save();

  const otpauthUri = generateURI({ secret, issuer: 'SyncUp Command', label: admin.username });
  return ok(res, { otpauthUri, secret });
}));

/**
 * POST /auth/mfa — TOTP/recovery + device signature → access + refresh.
 */
router.post('/mfa', adminMfaLimiter, handle(async (req, res) => {
  const {
    mfaTicket, code, recoveryCode, enrollmentCode,
    deviceId, deviceName, devicePublicKey, signature,
  } = req.body || {};

  let decoded;
  try {
    decoded = jwt.verify(mfaTicket, getAdminJwtSecret(), { audience: MFA_AUDIENCE });
  } catch {
    return fail(res, 401, 'MFA_TICKET_INVALID', 'Invalid or expired mfaTicket');
  }

  if (typeof deviceId !== 'string' || !deviceId.trim() ||
      typeof devicePublicKey !== 'string' || !devicePublicKey.trim() ||
      typeof signature !== 'string' || !signature.trim()) {
    return fail(res, 400, 'BAD_REQUEST', 'deviceId, devicePublicKey and signature are required');
  }

  const admin = await Admin.findById(decoded.sub)
    .select('+totp.secretEnc +totp.pendingSecretEnc +totp.recoveryCodes +totp.lastUsedStep +enrollment.codeHash');
  if (!admin || !admin.isActive) return fail(res, 401, 'MFA_TICKET_INVALID', 'Invalid or expired mfaTicket');
  if (admin.isLocked()) {
    const minutes = Math.ceil((admin.lockUntil - Date.now()) / 60000);
    return fail(res, 423, 'ACCOUNT_LOCKED', `Account locked. Try again in ${minutes} minutes.`);
  }

  // 1. Factor check
  let usedRecoveryCode = false;
  let issuedRecoveryCodes;
  const hasCode = typeof code === 'string' && code.trim();
  const hasRecovery = typeof recoveryCode === 'string' && recoveryCode.trim();

  if (hasCode) {
    if (admin.totp?.enabled && admin.totp.secretEnc) {
      const mfaError = await checkTotp(admin, admin.totp.secretEnc, code);
      if (mfaError) return fail(res, mfaError.status, mfaError.code, mfaError.message);
    } else if (admin.totp?.pendingSecretEnc) {
      const mfaError = await checkTotp(admin, admin.totp.pendingSecretEnc, code);
      if (mfaError) return fail(res, mfaError.status, mfaError.code, mfaError.message);
      // Promote pending → enabled and mint one-time recovery codes
      issuedRecoveryCodes = generateRecoveryCodes();
      admin.totp.secretEnc = admin.totp.pendingSecretEnc;
      admin.totp.pendingSecretEnc = undefined;
      admin.totp.enabled = true;
      admin.totp.recoveryCodes = issuedRecoveryCodes.map(sha256hex);
    } else {
      return fail(res, 401, 'MFA_NOT_ENROLLED', 'TOTP is not enrolled for this account');
    }
  } else if (hasRecovery) {
    const hash = sha256hex(recoveryCode.trim().toUpperCase());
    const codes = admin.totp?.recoveryCodes || [];
    const index = codes.indexOf(hash);
    if (index === -1) {
      await admin.incLoginAttempts();
      return fail(res, 401, 'INVALID_MFA_CODE', 'Invalid recovery code');
    }
    codes.splice(index, 1);
    admin.totp.recoveryCodes = codes;
    usedRecoveryCode = true;
  } else {
    return fail(res, 401, 'MFA_REQUIRED', 'A TOTP code or recovery code is required');
  }

  // 2. Device signature over the login nonce
  const payload = `syncup-admin-login:${decoded.nonce}:${deviceId.trim()}`;
  if (!verifyDeviceSignature(devicePublicKey, payload, signature)) {
    return fail(res, 401, 'INVALID_SIGNATURE', 'Device signature verification failed');
  }

  // 3. Device handling
  const devices = admin.devices || [];
  let device = devices.find(d => d.deviceId === deviceId.trim());

  if (device && device.publicKey && device.publicKey !== devicePublicKey) {
    return fail(res, 403, 'DEVICE_KEY_MISMATCH', 'Device key does not match the registered key');
  }
  if (device && device.status === 'revoked') {
    return fail(res, 403, 'DEVICE_REVOKED', 'This device has been revoked');
  }

  let autoApproved = false;
  if (typeof enrollmentCode === 'string' && enrollmentCode.trim() &&
      admin.enrollment?.codeHash && admin.enrollment.expiresAt > new Date() &&
      sha256hex(enrollmentCode.trim()) === admin.enrollment.codeHash) {
    autoApproved = true;
    admin.enrollment.codeHash = undefined;
    admin.enrollment.expiresAt = undefined;
  }
  if (usedRecoveryCode && admin.role === 'owner') autoApproved = true;

  if (!device) {
    device = {
      deviceId: deviceId.trim(),
      name: deviceName || 'Unknown device',
      publicKey: devicePublicKey,
      status: 'pending',
    };
    devices.push(device);
    device = devices[devices.length - 1];
  }

  if (autoApproved && device.status !== 'approved') {
    device.status = 'approved';
    device.approvedAt = new Date();
    device.approvedBy = admin._id;
  }

  if (device.status !== 'approved') {
    device.lastSeenAt = new Date();
    if (admin.loginAttempts > 0) await admin.resetLoginAttempts();
    await admin.save();
    emitAdminEvent('admin:device_pending', {
      adminId: String(admin._id), username: admin.username, deviceId: device.deviceId, name: device.name,
    });
    auditAuth(req, admin, 'auth.device_pending', { targetType: 'admin', targetId: admin._id });
    return res.status(202).json({ ok: true, data: { status: 'pending_device' } });
  }

  // 4. Approved → issue tokens
  device.lastSeenAt = new Date();
  admin.lastLogin = new Date();
  if (admin.loginAttempts > 0) await admin.resetLoginAttempts();
  await admin.save();

  const { session, refreshToken } = await createSession(admin, device.deviceId, req);
  const accessToken = signAccess(admin, session);

  auditAuth(req, admin, 'auth.login', { targetType: 'admin', targetId: admin._id });

  const data = {
    status: 'ok',
    accessToken,
    refreshToken,
    admin: adminProfile(admin),
  };
  if (issuedRecoveryCodes) data.recoveryCodes = issuedRecoveryCodes;
  return ok(res, data);
}));

/**
 * POST /auth/refresh — rotate the refresh token; reuse kills the family.
 */
router.post('/refresh', adminSessionLimiter, handle(async (req, res) => {
  const { refreshToken, deviceId } = req.body || {};
  if (typeof refreshToken !== 'string' || !refreshToken) {
    return fail(res, 401, 'SESSION_REVOKED', 'Invalid refresh token');
  }

  const session = await AdminSession.findOne({ refreshHash: sha256hex(refreshToken) });
  if (!session) {
    return fail(res, 401, 'SESSION_REVOKED', 'Invalid refresh token');
  }

  const revokeFamily = async () => {
    await AdminSession.updateMany(
      { familyId: session.familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  };

  // Reuse of a rotated or revoked refresh token → kill the whole family
  if (session.revokedAt || session.rotatedAt) {
    await revokeFamily();
    const admin = await Admin.findById(session.adminId).select('username role');
    auditAuth(req, admin, 'auth.refresh_reuse', { targetType: 'admin', targetId: session.adminId, result: 'failure' });
    return fail(res, 401, 'SESSION_REVOKED', 'Refresh token reuse detected; session revoked');
  }

  if (session.expiresAt <= new Date()) {
    return fail(res, 401, 'SESSION_REVOKED', 'Session expired');
  }

  const admin = await Admin.findById(session.adminId);
  if (!admin || !admin.isActive) {
    return fail(res, 401, 'SESSION_REVOKED', 'Session is no longer valid');
  }

  const device = admin.devices.find(d => d.deviceId === session.deviceId);
  if (!device || device.status !== 'approved' ||
      (deviceId && device.deviceId !== deviceId)) {
    return fail(res, 403, 'DEVICE_NOT_APPROVED', 'Device is not approved');
  }

  // Rotate: retire the old token, issue a new one in the same family
  const newRefreshToken = randomToken(48);
  const newSession = await AdminSession.create({
    adminId: admin._id,
    deviceId: session.deviceId,
    familyId: session.familyId,
    refreshHash: sha256hex(newRefreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    ip: req.ip,
    ua: req.headers['user-agent'],
  });
  session.rotatedAt = new Date();
  session.replacedBy = newSession._id;
  await session.save();

  const accessToken = signAccess(admin, newSession);
  auditAuth(req, admin, 'auth.refresh', { targetType: 'admin', targetId: admin._id });

  return ok(res, { accessToken, refreshToken: newRefreshToken });
}));

/**
 * POST /auth/logout — revoke the current session (requires access token).
 */
router.post('/logout', adminSessionLimiter, requireAdminV2, handle(async (req, res) => {
  await AdminSession.findByIdAndUpdate(req.adminSessionId, { $set: { revokedAt: new Date() } });
  auditAuth(req, req.admin, 'auth.logout', { targetType: 'admin', targetId: req.admin._id });
  return ok(res, { loggedOut: true });
}));

/**
 * POST /auth/step-up/challenge — mint a nonce the device must sign.
 */
router.post('/step-up/challenge', adminSessionLimiter, requireAdminV2, handle(async (req, res) => {
  const nonce = randomToken(16);
  const challengeToken = sign(
    { sub: String(req.admin._id), did: req.adminDevice.deviceId, nonce },
    CHALLENGE_AUDIENCE,
    CHALLENGE_TTL
  );
  return ok(res, { challengeToken, nonce });
}));

/**
 * POST /auth/step-up — exchange a signed challenge (or TOTP) for a step-up token.
 */
router.post('/step-up', adminSessionLimiter, requireAdminV2, handle(async (req, res) => {
  const { challengeToken, signature, totpCode } = req.body || {};
  const issue = () => ok(res, {
    stepUpToken: sign(
      { sub: String(req.admin._id), did: req.adminDevice.deviceId, scope: 'critical', typ: 'admin_stepup' },
      STEPUP_AUDIENCE,
      STEPUP_TTL
    ),
  });

  if (typeof totpCode === 'string' && totpCode.trim()) {
    const admin = await Admin.findById(req.admin._id).select('+totp.secretEnc +totp.lastUsedStep');
    if (!admin) return fail(res, 403, 'STEP_UP_INVALID', 'Step-up failed');
    if (admin.isLocked()) {
      return fail(res, 423, 'ACCOUNT_LOCKED', 'Account locked');
    }
    const mfaError = await checkTotp(admin, admin.totp?.secretEnc, totpCode);
    if (mfaError) {
      return fail(res, 403, 'STEP_UP_INVALID', 'Invalid TOTP code');
    }
    await admin.save(); // persist totp.lastUsedStep
    auditAuth(req, req.admin, 'auth.step_up', { targetType: 'admin', targetId: req.admin._id });
    return issue();
  }

  if (typeof challengeToken === 'string' && typeof signature === 'string' && challengeToken && signature) {
    let decoded;
    try {
      decoded = jwt.verify(challengeToken, getAdminJwtSecret(), { audience: CHALLENGE_AUDIENCE });
    } catch {
      return fail(res, 403, 'STEP_UP_INVALID', 'Invalid or expired challenge');
    }
    if (String(decoded.sub) !== String(req.admin._id) || decoded.did !== req.adminDevice.deviceId) {
      return fail(res, 403, 'STEP_UP_INVALID', 'Challenge does not match this device');
    }
    if (!verifyDeviceSignature(req.adminDevice.publicKey, `syncup-admin-stepup:${decoded.nonce}`, signature)) {
      return fail(res, 403, 'STEP_UP_INVALID', 'Device signature verification failed');
    }
    auditAuth(req, req.admin, 'auth.step_up', { targetType: 'admin', targetId: req.admin._id });
    return issue();
  }

  return fail(res, 400, 'BAD_REQUEST', 'challengeToken+signature or totpCode is required');
}));

module.exports = router;
