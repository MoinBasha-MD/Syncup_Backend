#!/usr/bin/env node
/**
 * Owner recovery utilities.
 *
 * Usage (combine flags):
 *   node ownerRecovery.js [--reset-mfa] [--revoke-devices] \
 *                                 [--new-enrollment-code] [--unlock]
 *
 *   --reset-mfa            New TOTP secret (prints secret + otpauth URI once)
 *                          and 10 new recovery codes.
 *   --revoke-devices       Revoke every device and every AdminSession of the
 *                          owner (bumps tokenVersion).
 *   --new-enrollment-code  Mint a new 24h one-time device enrollment code
 *                          (printed once).
 *   --unlock               Clear loginAttempts/lockUntil.
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();
const Admin = require('./models/Admin');
const AdminSession = require('./models/AdminSession');
const { encrypt, sha256hex, base32Token, generateRecoveryCodes } = require('./utils/adminCrypto');
const { recordAdminAction } = require('./services/adminAudit');
const { generateSecret, generateURI } = require('otplib');

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);

const resetMfa = hasFlag('reset-mfa');
const revokeDevices = hasFlag('revoke-devices');
const newEnrollmentCode = hasFlag('new-enrollment-code');
const unlock = hasFlag('unlock');

const recoveryCodes = () => generateRecoveryCodes();

const main = async () => {
  if (!resetMfa && !revokeDevices && !newEnrollmentCode && !unlock) {
    console.error('Usage: node ownerRecovery.js [--reset-mfa] [--revoke-devices] [--new-enrollment-code] [--unlock]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ MongoDB Connected');

  const owner = await Admin.findOne({ role: 'owner' });
  if (!owner) {
    console.error('❌ No owner account exists. Run createOwner.js first.');
    process.exit(1);
  }

  const actions = [];

  if (unlock) {
    owner.loginAttempts = 0;
    owner.lockUntil = undefined;
    actions.push('unlock');
  }

  if (resetMfa) {
    const totpSecret = generateSecret();
    const codes = generateRecoveryCodes();
    owner.totp = {
      secretEnc: encrypt(totpSecret),
      enabled: true,
      recoveryCodes: codes.map(sha256hex),
    };
    actions.push('reset-mfa');
    console.log('\n==========================================');
    console.log('NEW TOTP SECRET (shown once):');
    console.log(`  ${totpSecret}`);
    console.log(`  ${generateURI({ secret: totpSecret, issuer: 'SyncUp Command', label: owner.username })}`);
    console.log('\nNEW RECOVERY CODES (shown once):');
    codes.forEach(c => console.log(`  ${c}`));
    console.log('==========================================\n');
  }

  if (newEnrollmentCode) {
    const code = base32Token(24).match(/.{4}/g).join('-');
    owner.enrollment = { codeHash: sha256hex(code), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
    actions.push('new-enrollment-code');
    console.log(`\nNEW DEVICE ENROLLMENT CODE (valid 24h, shown once):\n  ${code}\n`);
  }

  if (revokeDevices) {
    owner.devices = (owner.devices || []).map(d => ({ ...d, status: 'revoked', revokedAt: new Date() }));
    owner.tokenVersion = (owner.tokenVersion || 0) + 1;
    const result = await AdminSession.updateMany(
      { adminId: owner._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    actions.push('revoke-devices');
    console.log(`✅ Revoked ${owner.devices.length} device(s) and ${result.modifiedCount} session(s)`);
  }

  await owner.save();

  await recordAdminAction({
    adminId: owner._id,
    adminUsername: 'cli',
    adminRole: 'owner',
    action: `admin.owner_recovery`,
    targetType: 'admin',
    targetId: String(owner._id),
    meta: { actions },
    result: 'success',
  });

  console.log(`✅ Done: ${actions.join(', ')}`);
  process.exit(0);
};

main().catch(error => {
  console.error('❌', error);
  process.exit(1);
});
