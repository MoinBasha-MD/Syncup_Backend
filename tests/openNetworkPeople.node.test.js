const test = require('node:test');
const assert = require('node:assert');

const { coarsenPoint, distanceLabel } = require('../services/openNetworkGeo');
const { pairKey, toPersonSummary } = require('../utils/openNetworkPeopleDto');

const hasGeoKeys = (value) => {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, v]) =>
      ['point', 'coordinates', 'lng', 'lat'].includes(key) || hasGeoKeys(v),
  );
};

test('coarsenPoint snaps to the 0.05° grid', () => {
  assert.deepEqual(coarsenPoint(73.8564, 18.5204), [73.85, 18.5]);
  assert.deepEqual(coarsenPoint(-73.999, 40.742), [-74, 40.75]);
  // Below half a cell → 0; just above → the next cell.
  assert.deepEqual(coarsenPoint(0.024, -0.026), [0, -0.05]);
});

test('coarsenPoint clamps to valid ranges', () => {
  assert.deepEqual(coarsenPoint(190, 95), [180, 90]);
});

test('distanceLabel buckets distances', () => {
  assert.equal(distanceLabel(0), '< 5 km');
  assert.equal(distanceLabel(4.9), '< 5 km');
  assert.equal(distanceLabel(7.3), '~5 km');
  assert.equal(distanceLabel(12.6), '~15 km');
  assert.equal(distanceLabel(47.4), '~45 km');
  assert.equal(distanceLabel(62), '~60 km');
  assert.equal(distanceLabel(287), '~290 km');
  assert.equal(distanceLabel(310), '310 km');
  assert.equal(distanceLabel(null), null);
});

test('pairKey is order-independent and sorted', () => {
  assert.equal(pairKey('alice', 'bob'), 'alice|bob');
  assert.equal(pairKey('bob', 'alice'), 'alice|bob');
  assert.notEqual(pairKey('alice', 'bob'), pairKey('alice', 'carol'));
});

test('toPersonSummary computes sharedInterests and never leaks geo', () => {
  const profile = {
    userId: 'u1',
    persona: { headline: 'Coffee chats', interests: ['music', 'coffee'], openTo: ['coffee'] },
    home: {
      city: 'Pune',
      country: 'India',
      // The stored coarse point must never appear in the DTO.
      point: { type: 'Point', coordinates: [73.85, 18.5] },
    },
    lastActiveAt: new Date(),
  };
  const user = { userId: 'u1', name: 'Asha', profileImage: 'https://x/img.png' };
  const s = toPersonSummary(profile, user, {
    viewerInterests: ['music', 'travel'],
    distanceKm: 7.3,
    connection: 'connected',
    isFriend: true,
    activeRippleCount: 2,
  });

  assert.equal(s.userId, 'u1');
  assert.equal(s.name, 'Asha');
  assert.equal(s.distanceLabel, '~5 km');
  assert.deepEqual(s.sharedInterests, ['music']);
  assert.equal(s.connection, 'connected');
  assert.equal(s.isFriend, true);
  assert.equal(s.activeRippleCount, 2);
  assert.equal(s.activeLabel, 'Active today');
  assert.equal(hasGeoKeys(s), false, 'summary leaked a coordinate field');
});

test('toPersonSummary is null-safe', () => {
  const s = toPersonSummary({ userId: 'u2' }, null, {});
  assert.equal(s.name, 'Someone');
  assert.equal(s.distanceLabel, null);
  assert.deepEqual(s.sharedInterests, []);
  assert.equal(s.activeLabel, null);
});
