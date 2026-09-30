/**
 * Open Network visibility — who may see which Ripples.
 * getViewerContext batches friends, blocks, and followed Pages for
 * discovery endpoints; it never runs a query per Ripple.
 */
const Friend = require('../models/Friend');
const Block = require('../models/blockModel');
const PageFollower = require('../models/PageFollower');

/**
 * Pure friend-id rule shared with the main app (Friend.getFriends /
 * profileController): an accepted non-device-contact row in EITHER direction
 * makes the pair friends; a device-contact row counts only when the other
 * side also holds an accepted row back.
 */
const computeFriendIds = (myRows, theirRows) => {
  const mine = new Map();
  myRows.forEach((r) => mine.set(String(r.friendUserId), r));
  const theirs = new Map();
  theirRows.forEach((r) => theirs.set(String(r.userId), r));

  const friendIds = new Set();
  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    const m = mine.get(id);
    const t = theirs.get(id);
    if ((m && !m.isDeviceContact) || (t && !t.isDeviceContact) || (m && t)) {
      friendIds.add(id);
    }
  }
  return friendIds;
};

/**
 * @returns {{ friendIds: Set<string>, blockedIds: Set<string>, pageIds: Set<string> }}
 */
const getViewerContext = async (userId, userObjectId = null) => {
  // DELIBERATE DEVIATION from Friend.getFriends(): that static loops over
  // each friendship with a reciprocal query per row and logs heavily —
  // unusable on a hot discovery path. These two lean queries fetch both
  // directions at once and computeFriendIds applies the same rule: either
  // side's accepted non-device-contact row makes them friends; device
  // contacts only count when mutual.
  const [myRows, theirRows, iBlocked, blockedMe, pageRows] = await Promise.all([
    Friend.find({ userId, status: 'accepted', isDeleted: false })
      .select('friendUserId isDeviceContact')
      .lean(),
    Friend.find({ friendUserId: userId, status: 'accepted', isDeleted: false })
      .select('userId isDeviceContact')
      .lean(),
    Block.find({ blockerId: userId }).select('blockedUserId').lean(),
    Block.find({ blockedUserId: userId }).select('blockerId').lean(),
    userObjectId ? PageFollower.find({ userId: userObjectId }).select('pageId').lean() : [],
  ]);

  const friendIds = computeFriendIds(myRows, theirRows);
  const blockedIds = new Set([
    ...iBlocked.map((r) => r.blockedUserId),
    ...blockedMe.map((r) => r.blockerId),
  ]);
  const pageIds = new Set(pageRows.map((r) => String(r.pageId)));

  return { friendIds, blockedIds, pageIds };
};

/**
 * Mongo filter fragment for "Ripples this viewer is allowed to discover".
 * NOTE: Ripples the viewer is already a Rippler of are added by the caller
 * (requires a Rippler lookup) — not expressible here.
 */
const buildVisibilityFilter = (viewerUserId, ctx) => ({
  $and: [
    {
      $or: [
        { visibility: 'public', discoverability: 'listed' },
        { visibility: 'friends', hostUserId: { $in: [...ctx.friendIds] } },
        { visibility: 'page_followers', hostPageId: { $in: [...(ctx.pageIds ?? [])] } },
        { hostUserId: viewerUserId },
      ],
    },
    { hostUserId: { $nin: [...ctx.blockedIds] } },
    {
      $or: [
        { 'moderation.reviewStatus': { $ne: 'under_review' } },
        { hostUserId: viewerUserId },
      ],
    },
  ],
});

module.exports = {
  getViewerContext,
  buildVisibilityFilter,
  computeFriendIds,
};
