/**
 * Shared "can this user view this Ripple?" ladder — the exact same checks
 * getRipple applies, reused by listEvents and the event mutation endpoints
 * so every read/write path enforces identical visibility rules.
 *
 * `member` is the viewer's Rippler row (may be null); only rows whose
 * status is in Rippler.VIEWING_STATUSES count as membership for viewing.
 */
const Rippler = require('../models/Rippler');

const canView = (ripple, member, ctx, userId) => {
  if (ctx.blockedIds.has(ripple.hostUserId)) return false;
  if (ripple.lifecycle === 'removed') return ripple.hostUserId === userId;
  if (
    ripple.hostUserId === userId ||
    (member && Rippler.VIEWING_STATUSES.includes(member.status))
  ) {
    return true;
  }
  if (ripple.moderation?.reviewStatus === 'under_review') return false;
  if (ripple.visibility === 'public') return true; // listed + unlisted: direct-link access
  if (ripple.visibility === 'friends') return ctx.friendIds.has(ripple.hostUserId);
  if (ripple.visibility === 'page_followers') return !!ctx.pageIds?.has(String(ripple.hostPageId));
  return false; // 'invite' — members only
};

module.exports = { canView };
