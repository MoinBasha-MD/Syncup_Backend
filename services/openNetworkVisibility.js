/**
 * Open Network visibility — who may see which Ripples.
 * getViewerContext batches reciprocal friends, blocks, and followed Pages for
 * discovery endpoints; it never runs a query per Ripple.
 */
const Friend = require('../models/Friend');
const Block = require('../models/blockModel');
const PageFollower = require('../models/PageFollower');

/**
 * @returns {{ friendIds: Set<string>, blockedIds: Set<string>, pageIds: Set<string> }}
 */
const getViewerContext = async (userId, userObjectId = null) => {
  // DELIBERATE DEVIATION from Friend.getFriends(): that static loops over
  // each friendship with a reciprocal query per row and logs heavily —
  // unusable on a hot discovery path. These two lean queries achieve the
  // same reciprocal check: (a) rows I hold, (b) of those, which hold me
  // back. Intersection = confirmed mutual friends.
  const [myRows, iBlocked, blockedMe, pageRows] = await Promise.all([
    Friend.find({ userId, status: 'accepted', isDeleted: false })
      .select('friendUserId')
      .lean(),
    Block.find({ blockerId: userId }).select('blockedUserId').lean(),
    Block.find({ blockedUserId: userId }).select('blockerId').lean(),
    userObjectId ? PageFollower.find({ userId: userObjectId }).select('pageId').lean() : [],
  ]);

  const candidateIds = myRows.map((r) => r.friendUserId);
  const reciprocal = candidateIds.length
    ? await Friend.find({
        friendUserId: userId,
        userId: { $in: candidateIds },
        status: 'accepted',
        isDeleted: false,
      })
        .select('userId')
        .lean()
    : [];

  const friendIds = new Set(reciprocal.map((r) => r.userId));
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
};
