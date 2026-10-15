const test = require('node:test');
const assert = require('node:assert');
const {
  YOURS_FEED_TABS,
  getYoursFeedClause,
  getFeedSortField,
} = require('../services/openNetworkFeed');

test('Yours feed tabs are ordered Shorts, Live, Ripples', () => {
  assert.deepEqual(YOURS_FEED_TABS, ['shorts', 'live', 'ripples']);
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
