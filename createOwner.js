#!/usr/bin/env node
/**
 * Create the initial SyncUp Command owner.
 *
 * Usage:
 *   node createOwner.js --username <u> [--email <e>] [--promote]
 *
 * Password comes from OWNER_PASSWORD env or a hidden interactive prompt
 * (min 12 chars). Also generates:
 *   - a TOTP secret (stored encrypted, printed once with otpauth URI)
 *   - 10 recovery codes (printed once)
 *   - a one-time device enrollment code (24h, printed once)
 *
 * --promote converts the existing admin `username` to owner via a direct
 * collection update — that is the ONLY intended path around the model's
 * owner-role guards.
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const readline = require('readline');

dotenv.config();
const Admin = require('./models/Admin');
const { encrypt, sha256hex, base32Token, generateRecoveryCodes } = require('./utils/adminCrypto');
const { recordAdminAction } = require('./services/adminAudit');
const { TOTP, NobleCryptoPlugin, ScureBase32Plugin, generateSecret, generateURI } = require('otplib');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(`--${name}`);

const username = flag('username');
const email = flag('email');
const promote = hasFlag('promote');

const hiddenPrompt = (query) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const originalWrite = rl._writeToOutput;
  rl._writeToOutput = function (chunk) {
    if (chunk.includes('\n') || chunk === '\r\n') {
      originalWrite.call(rl, chunk);
    } else {
      originalWrite.call(rl, '*');
    }
  };
  rl.question(query, (answer) => {
    rl._writeToOutput = originalWrite;
    rl.close();
    process.stdout.write('\n');
    resolve(answer);
  });
});

const connectDB = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ MongoDB Connected');
};

const main = async () => {
  if (!username) {
    console.error('❌ --username is required');
    process.exit(1);
  }

  await connectDB();

  const existingOwner = await Admin.findOne({ role: 'owner' }).lean();
  if (existingOwner) {
    console.error(`❌ An owner already exists (${existingOwner.username}). Use ownerRecovery.js instead.`);
    process.exit(1);
  }

  let password = process.env.OWNER_PASSWORD;
  if (!password) {
    password = await hiddenPrompt('Owner password (min 12 chars): ');
  }
  if (typeof password !== 'string' || password.length < 12) {
    console.error('❌ Password must be at least 12 characters');
    process.exit(1);
  }

  const totpSecret = generateSecret();
  const recoveryCodes = generateRecoveryCodes();
  const enrollmentCode = base32Token(24).match(/.{4}/g).join('-');

  let admin;
  if (promote) {
    admin = await Admin.findOne({ username: username.toLowerCase() });
    if (!admin) {
      console.error(`❌ No admin found with username '${username}' to promote`);
      process.exit(1);
    }
    // Direct collection update — the model guards refuse role:'owner' updates
    // on purpose; this script is the only intended path around them.
    await Admin.collection.updateOne(
      { _id: admin._id },
      {
        $set: {
          role: 'owner',
          password: require('bcryptjs').hashSync(password, 10),
          isActive: true,
          totp: {
            secretEnc: encrypt(totpSecret),
            enabled: true,
            recoveryCodes: recoveryCodes.map(sha256hex),
          },
          enrollment: { codeHash: sha256hex(enrollmentCode), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
        },
      }
    );
    admin = await Admin.findById(admin._id);
    console.log(`✅ Promoted '${username}' to owner`);
  } else {
    admin = await Admin.create({
      username: username.toLowerCase(),
      password,
      email: email ? email.toLowerCase() : undefined,
      role: 'owner',
      isActive: true,
      totp: {
        secretEnc: encrypt(totpSecret),
        enabled: true,
        recoveryCodes: recoveryCodes.map(sha256hex),
      },
      enrollment: { codeHash: sha256hex(enrollmentCode), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    console.log(`✅ Created owner '${username}'`);
  }

  await recordAdminAction({
    adminId: admin._id,
    adminUsername: 'cli',
    adminRole: 'owner',
    action: 'admin.owner_created',
    targetType: 'admin',
    targetId: String(admin._id),
    result: 'success',
  });

  const otpauthUri = generateURI({ secret: totpSecret, issuer: 'SyncUp Command', label: admin.username });

  console.log('\n==========================================');
  console.log('TOTP SECRET (store in authenticator app):');
  console.log(`  ${totpSecret}`);
  console.log(`  ${otpauthUri}`);
  console.log('\nRECOVERY CODES (shown once — store offline):');
  recoveryCodes.forEach(c => console.log(`  ${c}`));
  console.log('\nDEVICE ENROLLMENT CODE (valid 24h, shown once):');
  console.log(`  ${enrollmentCode}`);
  console.log('==========================================\n');

  process.exit(0);
};

main().catch(error => {
  console.error('❌', error);
  process.exit(1);
});
