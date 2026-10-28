const mongoose = require('mongoose');
const dotenv = require('dotenv');
const PartnerAdminKey = require('../models/PartnerAdminKey');
const { generateAdminKeySecret, digestSecret } = require('../utils/syncSpaceCrypto');

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (error) {
    console.error('MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

const fmt = (value) => (value ? value.toISOString() : '-');

const createKey = async (label) => {
  if (!label || label.length > 60) {
    throw new Error('A --label of 1-60 characters is required');
  }
  const secret = generateAdminKeySecret();
  const doc = await PartnerAdminKey.create({
    keyId: `ak_${require('crypto').randomBytes(4).toString('hex')}`,
    label,
    secretHash: digestSecret(secret),
  });
  console.log(`Created admin key ${doc.keyId} (${label})`);
  console.log('\nAdmin access key (shown once — store it somewhere safe):\n');
  console.log(`  ${secret}\n`);
  console.log('This key cannot be recovered. If it is lost, revoke it and create a new one.');
};

const listKeys = async () => {
  const keys = await PartnerAdminKey.find({}).sort({ createdAt: -1 }).lean();
  if (!keys.length) {
    console.log('No admin keys.');
    return;
  }
  for (const key of keys) {
    console.log(
      `${key.keyId}  ${key.label}  created=${fmt(key.createdAt)}  lastUsed=${fmt(key.lastUsedAt)}  revoked=${fmt(key.revokedAt)}`
    );
  }
};

const revokeKey = async (keyId) => {
  const updated = await PartnerAdminKey.findOneAndUpdate(
    { keyId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true }
  );
  if (!updated) {
    console.log(`No active key ${keyId} found.`);
    return;
  }
  console.log(`Revoked ${updated.keyId} (${updated.label}). Existing sessions are invalidated immediately.`);
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  const arg = (name) => {
    const idx = rest.indexOf(`--${name}`);
    return idx >= 0 ? rest[idx + 1] : undefined;
  };

  await connectDB();
  try {
    if (command === 'create') await createKey(arg('label'));
    else if (command === 'list') await listKeys();
    else if (command === 'revoke') await revokeKey(rest[0]);
    else {
      console.log('Usage: node scripts/partnerAdminKey.js <create --label "Owner"|list|revoke <keyId>>');
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
