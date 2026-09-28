require('dotenv').config();

const mongoose = require('mongoose');
const Ripple = require('./models/Ripple');
const Rippler = require('./models/Rippler');
const RippleEvent = require('./models/RippleEvent');
const RippleSupport = require('./models/RippleSupport');
const RippleInteractor = require('./models/RippleInteractor');

const BATCH_SIZE = 1000;

const upsertCursor = async (cursor, getUserId) => {
  let operations = [];
  let batchKeys = new Set();
  let total = 0;
  const flush = async () => {
    if (!operations.length) return;
    await RippleInteractor.bulkWrite(operations, { ordered: false });
    total += operations.length;
    operations = [];
    batchKeys = new Set();
  };

  for await (const row of cursor) {
    const userId = getUserId(row);
    if (!row.rippleId || !userId) continue;
    const key = `${row.rippleId}:${userId}`;
    if (batchKeys.has(key)) continue;
    batchKeys.add(key);
    operations.push({
      updateOne: {
        filter: { rippleId: row.rippleId, userId },
        update: { $setOnInsert: { rippleId: row.rippleId, userId } },
        upsert: true,
      },
    });
    if (operations.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return total;
};

const run = async () => {
  if (!process.argv.includes('--apply')) {
    console.log('No changes made. Pass --apply to backfill Ripple interactor counts.');
    return;
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);
  await RippleInteractor.createIndexes();

  const members = await upsertCursor(
    Rippler.find({ status: { $in: ['approved', 'left', 'removed', 'banned'] }, role: { $nin: ['follower', 'host'] } })
      .select('rippleId userId')
      .lean()
      .cursor(),
    (row) => row.userId,
  );
  const events = await upsertCursor(
    RippleEvent.find({ origin: 'user' }).select('rippleId authorId').lean().cursor(),
    (row) => row.authorId,
  );
  const supports = await upsertCursor(
    RippleSupport.find().select('rippleId userId').lean().cursor(),
    (row) => row.userId,
  );

  const totals = await RippleInteractor.aggregate([
    { $group: { _id: '$rippleId', count: { $sum: 1 } } },
  ]);
  const countByRipple = new Map(totals.map((row) => [String(row._id), row.count]));
  let updates = [];
  const flushCounts = async () => {
    if (!updates.length) return;
    await Ripple.bulkWrite(updates, { ordered: false });
    updates = [];
  };
  for await (const ripple of Ripple.find().select('_id').lean().cursor()) {
    updates.push({
      updateOne: {
        filter: { _id: ripple._id },
        update: { $set: { 'counts.interactors': countByRipple.get(String(ripple._id)) ?? 0 } },
      },
    });
    if (updates.length >= BATCH_SIZE) await flushCounts();
  }
  await flushCounts();

  console.log('Ripple interactor backfill complete', { members, events, supports, ripples: countByRipple.size });
};

run()
  .catch((error) => {
    console.error('Ripple interactor backfill failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
