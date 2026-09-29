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

/* ------------------------- viewport time windows ------------------------- */

const { timeWindowClause } = require('../services/openNetworkGeo');
const NOW = new Date('2026-02-20T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const matches = (clause, doc) => {
  // Tiny $or/$and/field-op evaluator — enough for the window clauses' shape.
  const cmp = (actual, cond) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$gte' in cond && !(actual instanceof Date && actual >= cond.$gte)) {
        if (!(actual >= cond.$gte)) return false;
      }
      if ('$lte' in cond && !(actual <= cond.$lte)) return false;
      if ('$in' in cond && !cond.$in.includes(actual)) return false;
      if ('$ne' in cond && actual === cond.$ne) return false;
      return true;
    }
    return actual === cond;
  };
  const branch = (c) =>
    Object.entries(c).every(([k, v]) => {
      if (k === '$or') return v.some(branch);
      if (k === '$and') return v.every(branch);
      return cmp(doc[k], v);
    });
  return branch(clause);
};

test("timeWindowClause 'all' (and unknown) returns null", () => {
  assert.equal(timeWindowClause('all', NOW), null);
  assert.equal(timeWindowClause('bogus', NOW), null);
});

test("window 'now' keeps live Ripples and day-fresh Shorts only", () => {
  const c = timeWindowClause('now', NOW);
  assert.ok(matches(c, { kind: 'ripple', lifecycle: 'active' }));
  assert.ok(matches(c, { kind: 'ripple', lifecycle: 'wrapping' }));
  assert.ok(
    matches(c, { kind: 'short', lifecycle: 'active', createdAt: new Date(NOW.getTime() - 2 * 3600e3) }),
  );
  // A scheduled-but-not-started Ripple and a stale Short both drop out.
  assert.ok(!matches(c, { kind: 'ripple', lifecycle: 'scheduled' }));
  assert.ok(
    !matches(c, { kind: 'short', lifecycle: 'active', createdAt: new Date(NOW.getTime() - DAY - 1000) }),
  );
});

test("window 'today' covers ±window starts and fresh posts", () => {
  const c = timeWindowClause('today', NOW);
  assert.ok(matches(c, { startAt: new Date(NOW.getTime() + 3600e3) }));
  assert.ok(matches(c, { startAt: new Date(NOW.getTime() - 11 * 3600e3) }));
  assert.ok(matches(c, { createdAt: new Date(NOW.getTime() - 3600e3) }));
  // Starts 13h ago (outside window) and created 2d ago → no branch matches.
  assert.ok(
    !matches(c, {
      startAt: new Date(NOW.getTime() - 13 * 3600e3),
      createdAt: new Date(NOW.getTime() - 2 * DAY),
    }),
  );
});

test("window 'week' covers upcoming week starts and recent posts", () => {
  const c = timeWindowClause('week', NOW);
  assert.ok(matches(c, { startAt: new Date(NOW.getTime() + 3 * DAY) }));
  assert.ok(matches(c, { createdAt: new Date(NOW.getTime() - 2 * DAY) }));
  // Started yesterday but created 10 days ago → outside both branches.
  assert.ok(
    !matches(c, {
      startAt: new Date(NOW.getTime() - DAY),
      createdAt: new Date(NOW.getTime() - 10 * DAY),
    }),
  );
});
