const YOURS_FEED_TABS = ['shorts', 'ripples', 'live'];

const getYoursFeedClause = (tab) => {
  switch (tab) {
    case 'shorts':
      return { kind: 'short' };
    case 'ripples':
      return { kind: { $ne: 'short' }, lifecycle: { $nin: ['active', 'wrapping'] } };
    case 'live':
      return { kind: { $ne: 'short' }, lifecycle: { $in: ['active', 'wrapping'] } };
    default:
      return null;
  }
};

const getFeedSortField = (section) =>
  section === 'forYou' || section === 'yours' ? 'updatedAt' : 'createdAt';

module.exports = { YOURS_FEED_TABS, getYoursFeedClause, getFeedSortField };

const YOURS_FEED_TABS = ['shorts', 'ripples', 'live'];
const FOR_YOU_FEED_TABS = ['combined', 'own', 'friends'];

const getYoursFeedClause = (tab) => {
  switch (tab) {
    case 'shorts':
      return { kind: 'short' };
    case 'ripples':
      return { kind: { $ne: 'short' }, lifecycle: { $nin: ['active', 'wrapping'] } };
    case 'live':
      return { kind: { $ne: 'short' }, lifecycle: { $in: ['active', 'wrapping'] } };
    default:
      return null;
  }
};

const getForYouFeedClause = (tab, userId, friendIds, pageIds, latestOwnRippleId) => {
  if (tab === 'own') {
    return {
      hostUserId: userId,
      _id: latestOwnRippleId ?? { $in: [] },
      kind: { $ne: 'short' },
    };
  }
  if (tab === 'friends') {
    return { hostUserId: { $in: friendIds }, kind: { $ne: 'short' } };
  }
  return {
    kind: { $ne: 'short' },
    $or: [
      { hostUserId: { $in: friendIds } },
      ...(latestOwnRippleId ? [{ _id: latestOwnRippleId }] : []),
      ...(pageIds.length ? [{ visibility: 'page_followers', hostPageId: { $in: pageIds } }] : []),
    ],
  };
};

const getFeedSortField = () => 'createdAt';

module.exports = {
  YOURS_FEED_TABS,
  FOR_YOU_FEED_TABS,
  getYoursFeedClause,
  getForYouFeedClause,
  getFeedSortField,
};
