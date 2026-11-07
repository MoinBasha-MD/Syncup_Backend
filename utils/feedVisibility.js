const Friend = require('../models/Friend');

// Friendships are stored in both directions in this codebase; accept either.
const isFriendPair = async (userId, otherUserId) => {
  if (!userId || !otherUserId) return false;
  const [forward, reverse] = await Promise.all([
    Friend.areFriends(userId, otherUserId),
    Friend.areFriends(otherUserId, userId),
  ]);
  return forward || reverse;
};

/**
 * Post visibility used by every direct-by-id read path.
 * 'private' is owner-only; page-targeted visibility is enforced by page code.
 */
const canViewFeedPost = async (post, viewerUserId) => {
  if (!post) return false;
  if (String(post.userId) === String(viewerUserId)) return true;
  // Targeted page-post copies carry the audience on the document.
  if (String(post.targetUserId) === String(viewerUserId)) return true;
  if (Array.isArray(post.targetUserIds) &&
      post.targetUserIds.some((id) => String(id) === String(viewerUserId))) return true;
  if (post.privacy === 'public') return true;
  if (post.privacy === 'friends') return isFriendPair(viewerUserId, post.userId);
  return false;
};

module.exports = { canViewFeedPost, isFriendPair };
