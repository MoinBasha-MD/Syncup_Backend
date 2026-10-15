const test = require('node:test');
const assert = require('node:assert');
const {
  YOURS_FEED_TABS,
  getYoursFeedClause,
  getFeedSortField,
} = require('../services/openNetworkFeed');

test('Yours feed tabs are ordered Shorts, Ripples, Live', () => {
  assert.deepEqual(YOURS_FEED_TABS, ['shorts', 'ripples', 'live']);
});

test('Yours Shorts tab only matches Shorts', () => {
  assert.deepEqual(getYoursFeedClause('shorts'), { kind: 'short' });
});

test('Yours Ripples tab excludes Shorts and still-open Ripples', () => {
  assert.deepEqual(getYoursFeedClause('ripples'), {
    kind: { $ne: 'short' },
    lifecycle: { $nin: ['active', 'wrapping'] },
  });
});

test('Yours Live tab keeps active and wrapping regular Ripples', () => {
  assert.deepEqual(getYoursFeedClause('live'), {
    kind: { $ne: 'short' },
    lifecycle: { $in: ['active', 'wrapping'] },
  });
});

test('only personal and friends feeds sort by last update', () => {
  assert.equal(getFeedSortField('yours'), 'updatedAt');
  assert.equal(getFeedSortField('forYou'), 'updatedAt');
  assert.equal(getFeedSortField('ripples'), 'createdAt');
});

const test = require('node:test');
const assert = require('node:assert');
const {
  YOURS_FEED_TABS,
  FOR_YOU_FEED_TABS,
  getYoursFeedClause,
  getForYouFeedClause,
  getFeedSortField,
} = require('../services/openNetworkFeed');

test('Yours feed tabs are ordered Shorts, Ripples, Live', () => {
  assert.deepEqual(YOURS_FEED_TABS, ['shorts', 'ripples', 'live']);
});

test('Yours Shorts tab only matches Shorts', () => {
  assert.deepEqual(getYoursFeedClause('shorts'), { kind: 'short' });
});

test('Yours Ripples tab excludes Shorts and still-open Ripples', () => {
  assert.deepEqual(getYoursFeedClause('ripples'), {
    kind: { $ne: 'short' },
    lifecycle: { $nin: ['active', 'wrapping'] },
  });
});

test('Yours Live tab keeps active and wrapping regular Ripples', () => {
  assert.deepEqual(getYoursFeedClause('live'), {
    kind: { $ne: 'short' },
    lifecycle: { $in: ['active', 'wrapping'] },
  });
});

test('Ripple feed tabs are ordered Combined, Own, Friends', () => {
  assert.deepEqual(FOR_YOU_FEED_TABS, ['combined', 'own', 'friends']);
});

test('Combined Ripple feed includes friends and only the latest own Ripple', () => {
  assert.deepEqual(
    getForYouFeedClause('combined', 'me', ['friend-1'], ['page-1'], 'own-latest'),
    {
      kind: { $ne: 'short' },
      $or: [
        { hostUserId: { $in: ['friend-1'] } },
        { _id: 'own-latest' },
        { visibility: 'page_followers', hostPageId: { $in: ['page-1'] } },
      ],
    },
  );
});

test('Own and Friends Ripple tabs have separate scopes', () => {
  assert.deepEqual(getForYouFeedClause('own', 'me', ['friend-1'], [], 'own-latest'), {
    hostUserId: 'me',
    _id: 'own-latest',
    kind: { $ne: 'short' },
  });
  assert.deepEqual(getForYouFeedClause('friends', 'me', ['friend-1'], [], null), {
    hostUserId: { $in: ['friend-1'] },
    kind: { $ne: 'short' },
  });
});

test('feeds sort by creation time so newest Ripples appear first', () => {
  assert.equal(getFeedSortField('yours'), 'createdAt');
  assert.equal(getFeedSortField('forYou'), 'createdAt');
  assert.equal(getFeedSortField('ripples'), 'createdAt');
});
