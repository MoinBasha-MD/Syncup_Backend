/**
 * Fix Script: Drop the conflicting unique index from the friends collection.
 *
 * PROBLEM:
 *   The friends collection has TWO unique indexes on overlapping fields:
 *     1. userId_1_friendUserId_1            (unique, WITHOUT isDeleted)  <- BAD
 *     2. userId_1_friendUserId_1_isDeleted_1 (unique, WITH isDeleted)    <- GOOD
 *
 *   The bad index (#1) only allows ONE document per (userId, friendUserId)
 *   pair, regardless of isDeleted. This blocks re-adding a friend after
 *   unfriending (soft-delete), causing:
 *     E11000 duplicate key error: rightview.friends index: userId_1_friendUserId_1
 *
 * FIX:
 *   - Drop the bad index #1 from MongoDB.
 *   - The good index #2 already prevents duplicates correctly while allowing
 *     soft-deleted records to coexist with active ones.
 *
 * USAGE (on the VPS):
 *   node fix-friends-duplicate-index.js
 *
 *   Or with a custom Mongo URI:
 *   MONGO_URI=mongodb://localhost:27017/rightview node fix-friends-duplicate-index.js
 */

const mongoose = require('mongoose');

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/rightview';

  console.log('Connecting to MongoDB:', mongoUri);

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  const collection = mongoose.connection.db.collection('friends');

  // List all indexes before
  const indexesBefore = await collection.indexes();
  console.log('\nCurrent indexes on friends collection:');
  indexesBefore.forEach(idx => {
    const fields = Object.keys(idx.key).map(k => `${k}:${idx.key[k]}`).join(', ');
    console.log(`   - ${idx.name}: { ${fields} } unique=${!!idx.unique}`);
  });

  // The bad index to drop
  const badIndexName = 'userId_1_friendUserId_1';

  const badIndex = indexesBefore.find(idx => idx.name === badIndexName);

  if (!badIndex) {
    console.log(`\nIndex "${badIndexName}" does not exist. Nothing to drop - already fixed.`);
    await mongoose.disconnect();
    return;
  }

  console.log(`\nFound bad index "${badIndexName}" - dropping it now...`);

  try {
    await collection.dropIndex(badIndexName);
    console.log(`Successfully dropped index "${badIndexName}"`);
  } catch (error) {
    console.error(`Failed to drop index:`, error.message);
    await mongoose.disconnect();
    process.exit(1);
  }

  // Verify after
  const indexesAfter = await collection.indexes();
  console.log('\nRemaining indexes on friends collection:');
  indexesAfter.forEach(idx => {
    const fields = Object.keys(idx.key).map(k => `${k}:${idx.key[k]}`).join(', ');
    console.log(`   - ${idx.name}: { ${fields} } unique=${!!idx.unique}`);
  });

  const stillExists = indexesAfter.some(idx => idx.name === badIndexName);
  if (stillExists) {
    console.error(`\nIndex "${badIndexName}" still exists! Manual intervention needed.`);
    process.exit(1);
  } else {
    console.log(`\nConfirmed: "${badIndexName}" has been removed.`);
    console.log('The good unique index "userId_1_friendUserId_1_isDeleted_1" remains.');
    console.log('Friend re-adding after unfriend should now work correctly.');
  }

  await mongoose.disconnect();
  console.log('\nDisconnected from MongoDB. Done.');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
