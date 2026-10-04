/**
 * Meetup expiry sweep.
 *
 * Runs from MasterScheduler's existing 1-minute job — meetups that pass
 * expiresAt are ended server-side and every participant is told over the
 * socket so clients stop tracking (the listMyMeetups safety net only covers
 * users who reopen the list).
 */

const Meetup = require('../models/Meetup');
const getSocketManager = () => require('../socketManager');

async function expireDueMeetups(now = new Date()) {
  let ended = 0;

  const due = await Meetup.find({
    status: 'active',
    expiresAt: { $lte: now },
  }).select('_id participants.userId').lean();

  for (const m of due) {
    // Guard on status so a concurrent host 'end' can't double-notify.
    const res = await Meetup.updateOne(
      { _id: m._id, status: 'active' },
      { $set: { status: 'ended', endedAt: now } },
    );
    if (!res.modifiedCount) continue;

    ended += 1;
    try {
      const { broadcastToUser } = getSocketManager();
      (m.participants || []).forEach((p) => {
        try {
          broadcastToUser(p.userId, 'meetup:ended', { meetupId: String(m._id) });
        } catch (e) { /* best-effort */ }
      });
    } catch (e) {
      console.error('❌ [MEETUP LIFECYCLE] ended broadcast failed:', e.message);
    }
  }

  if (ended) {
    console.log(`📍 [MEETUP LIFECYCLE] expired=${ended}`);
  }
  return ended;
}

module.exports = { expireDueMeetups };
