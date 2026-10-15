const YOURS_FEED_TABS = ['shorts', 'live', 'ripples'];

const getYoursFeedClause = (tab) => {
  switch (tab) {
    case 'shorts':
      return { kind: 'short' };
    case 'live':
      return { kind: { $ne: 'short' }, lifecycle: { $in: ['active', 'wrapping'] } };
    case 'ripples':
      return { kind: { $ne: 'short' }, lifecycle: { $nin: ['active', 'wrapping'] } };
    default:
      return null;
  }
};

const getFeedSortField = (section) =>
  section === 'forYou' || section === 'yours' ? 'updatedAt' : 'createdAt';

module.exports = { YOURS_FEED_TABS, getYoursFeedClause, getFeedSortField };
