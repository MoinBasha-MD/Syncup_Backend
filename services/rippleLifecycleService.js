/**
 * Ripple lifecycle transitions (Open Network).
 *
 * Runs from MasterScheduler's existing 1-minute job — deliberately not a new
 * cron, since that scheduler exists specifically to consolidate background work.
 *
 * Transitions, all server-authoritative:
 *   scheduled -> active    when startAt has passed
 *   active    -> wrapping  when expiresAt has passed (48h grace, not a freeze)
 *   wrapping  -> memory    when wrapUntil has passed (frozen, read-only)
 *
 * The `wrapping` window exists because people post their trip photos *after*
 * the trip, not during it — freezing at expiry would discard the best content
 * the feature produces.
 */

const Ripple = require('../models/Ripple');
const RippleEvent = require('../models/RippleEvent');
const getSocketManager = () => require('../socketManager');

const WRAP_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Best-effort system timeline entry; never allowed to fail the run. */
const addSystemEvent = async (rippleId, body) => {
  try {
    await RippleEvent.create({
      rippleId,
      authorId: 'system',
      authorName: '',
      origin: 'system',
      type: 'system',
      body,
    });
  } catch (e) {
    console.error('❌ [RIPPLE LIFECYCLE] system event failed:', e.message);
  }
};

async function runRippleLifecycle() {
  const now = new Date();
  let started = 0;
  let ended = 0;
  let frozen = 0;

  try {
    // --- scheduled -> active ---
    const toActivate = await Ripple.find({
      lifecycle: 'scheduled',
      startAt: { $ne: null, $lte: now },
    }).select('_id').lean();

    for (const r of toActivate) {
      await Ripple.updateOne(
        { _id: r._id, lifecycle: 'scheduled' },
        { $set: { lifecycle: 'active' } },
      );
      started += 1;
    }

    // --- active -> wrapping (auto-end when expiresAt passes) ---
    const toWrap = await Ripple.find({
      lifecycle: 'active',
      expiresAt: { $ne: null, $lte: now },
    }).select('_id').lean();

    for (const r of toWrap) {
      // Guard on lifecycle so a concurrent host 'end' can't be double-applied.
      const res = await Ripple.updateOne(
        { _id: r._id, lifecycle: 'active' },
        { $set: { lifecycle: 'wrapping', wrapUntil: new Date(now.getTime() + WRAP_WINDOW_MS) } },
      );
      if (res.modifiedCount) {
        ended += 1;
        await addSystemEvent(r._id, 'This Ripple has ended. Memories can still be added for 48 hours.');
      }
    }

    // --- wrapping -> memory (freeze) ---
    const toFreeze = await Ripple.find({
      lifecycle: 'wrapping',
      wrapUntil: { $ne: null, $lte: now },
    }).select('_id hostUserId title').lean();

    for (const r of toFreeze) {
      const res = await Ripple.updateOne(
        { _id: r._id, lifecycle: 'wrapping' },
        { $set: { lifecycle: 'memory' } },
      );
      if (res.modifiedCount) {
        frozen += 1;
        await addSystemEvent(r._id, 'This Ripple is now a Memory.');
        // Notify participants that the memory is live. Targeted only — we do
        // NOT broadcast a memory to every user on the platform.
        try {
          const Rippler = require('../models/Rippler');
          const members = await Rippler.find({
            rippleId: r._id,
            status: 'approved',
          }).select('userId').lean();
          members.forEach((m) => {
            try {
              getSocketManager().broadcastToUser(m.userId, 'ripple:memory:ready', {
                rippleId: String(r._id),
                title: r.title,
              });
            } catch (e) { /* best-effort */ }
          });
        } catch (e) {
          console.error('❌ [RIPPLE LIFECYCLE] memory notify failed:', e.message);
        }
      }
    }

    if (started || ended || frozen) {
      console.log(
        `🌊 [RIPPLE LIFECYCLE] activated=${started} wrapping=${ended} memory=${frozen}`,
      );
    }
  } catch (error) {
    console.error('❌ [RIPPLE LIFECYCLE] Error:', error.message);
  }

  return { started, ended, frozen };
}

module.exports = { runRippleLifecycle, WRAP_WINDOW_MS };
