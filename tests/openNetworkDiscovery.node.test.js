const assert = require('node:assert/strict');
const test = require('node:test');

/*
 * People-layer discovery consent — opt-in only, legacy invisibility,
 * the opt-out race guard, and the chat/peer gates. No DB: models are
 * stubbed the same way rippleOngoing.node.test.js does it.
 */

const OpenNetworkProfile = require('../models/OpenNetworkProfile');
// No DB in this suite — save() would buffer against a real Mongo for 10s.
OpenNetworkProfile.prototype.save = async function () {
  return this;
};
const { toPersonSummary, toPersonMini } = require('../utils/openNetworkPeopleDto');
const { canView } = require('../utils/rippleAccess');

// Stub the DB-adjacent services BEFORE the controllers destructure them.
const geo = require('../services/openNetworkGeo');
let resolvePlaceCalls = 0;
geo.resolvePlace = async (lng, lat) => {
  resolvePlaceCalls += 1;
  return { city: 'Testville', country: 'TC', countryCode: 'TC', cityKey: 'tc:testville', label: `Snapped ${lng},${lat}` };
};
const visibility = require('../services/openNetworkVisibility');
let stubCtx = { friendIds: new Set(), blockedIds: new Set(), pageIds: new Set() };
visibility.getViewerContext = async () => stubCtx;
const notifyMod = require('../services/openNetworkNotify');
let notifyCalls = 0;
notifyMod.notifyUser = async () => {
  notifyCalls += 1;
};

const OpenConnection = require('../models/OpenConnection');
const OpenChat = require('../models/OpenChat');
const User = require('../models/userModel');

const main = require('../controllers/openNetworkController');
const social = require('../controllers/openNetworkSocialController');

const resStub = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return { json: (body) => { res.body = body; } };
  };
  res.json = (body) => { res.body = body; };
  return res;
};
// asyncHandler routes errors to next(), not to the returned promise —
// capture it here, express-style.
const call = (handler, req, res) =>
  new Promise((done) => {
    let settled = false;
    const finish = (e) => {
      if (!settled) { settled = true; done(e || null); }
    };
    Promise.resolve(handler(req, res, finish)).then(() => finish());
  });
const throws = async (fn) => { throw new Error('use call()'); };

test('model: discovery is off by default and needs switch + consent', () => {
  const p = new OpenNetworkProfile({ userId: 'u1' });
  assert.equal(p.settings.discoverable, false);
  assert.equal(p.settings.discoveryConsent, false);
  assert.equal(OpenNetworkProfile.isDiscoverable(p), false);
  p.joined = true;
  p.settings.discoverable = true;
  assert.equal(OpenNetworkProfile.isDiscoverable(p), false); // still no consent
  p.settings.discoveryConsent = true;
  assert.equal(OpenNetworkProfile.isDiscoverable(p), true);
});

test('legacy default-true members stay invisible until they re-consent', () => {
  // A row written before consent existed: discoverable true, no consent key.
  const legacy = { joined: true, settings: { discoverable: true } };
  assert.equal(OpenNetworkProfile.isDiscoverable(legacy), false);
  // The DTO masks their still-on-disk home/activity fields.
  const summary = toPersonSummary(
    { ...legacy, userId: 'old', persona: {}, home: { city: 'Leaktown', country: 'LC' }, lastActiveAt: new Date() },
    { name: 'Legacy' },
  );
  assert.equal(summary.city, '');
  assert.equal(summary.country, '');
  assert.equal(summary.activeLabel, null);
  const mini = toPersonMini(
    { ...legacy, userId: 'old', persona: {}, home: { city: 'Leaktown' } },
    { name: 'Legacy' },
  );
  assert.equal(mini.city, '');
});

test('consented members keep city + activity label in DTOs', () => {
  const p = {
    joined: true,
    userId: 'ok',
    settings: { discoverable: true, discoveryConsent: true },
    persona: {},
    home: { city: 'Pune', country: 'IN' },
    lastActiveAt: new Date(),
  };
  const s = toPersonSummary(p, { name: 'Ok' });
  assert.equal(s.city, 'Pune');
  assert.equal(s.activeLabel, 'Active today');
});

test('profileView returns effective settings for a legacy doc', () => {
  // Raw discoverable:true with no recorded consent is a legacy row — the
  // effective switch reports OFF so the client never republishes on it.
  const view = main.profileView({
    userId: 'u', joined: true, settings: { discoverable: true }, home: {},
  });
  assert.equal(view.settings.discoverable, false);
  assert.equal(view.settings.discoveryConsent, false);
  // A fully consented member reports ON.
  const on = main.profileView({
    userId: 'u',
    joined: true,
    settings: { discoverable: true, discoveryConsent: true },
    home: {},
  });
  assert.equal(on.settings.discoverable, true);
});

test('PATCH settings discoverable on records consent; off wipes home + activity', async () => {
  const profile = new OpenNetworkProfile({ userId: 'u1' });
  profile.joined = true;
  // A legacy row can still carry a home anchor from before consent existed.
  // Recording new consent must clear it BEFORE save — the old point is never
  // republished while the member waits for the next presence ping.
  profile.home = {
    city: 'Oldtown', label: 'Oldtown',
    point: { type: 'Point', coordinates: [77, 12] },
    updatedAt: new Date(),
  };
  profile.lastActiveAt = new Date();
  const origGet = OpenNetworkProfile.getOrCreate;
  OpenNetworkProfile.getOrCreate = async () => profile;
  try {
    // ON — one switch flips both booleans.
    let res = resStub();
    await call(main.updateSettings, { body: { discoverable: true }, user: { userId: 'u1' } }, res);
    assert.equal(profile.settings.discoverable, true);
    assert.equal(profile.settings.discoveryConsent, true);
    assert.equal(res.body.profile.settings.discoveryConsent, true);
    // The legacy anchor was cleared by the consent write, not by a later ping.
    assert.equal(profile.home.city, '');
    assert.equal(profile.home.point?.coordinates, undefined);
    assert.equal(profile.lastActiveAt, null);

    // Give it a home anchor + activity as if presence had published.
    profile.home = { city: 'Pune', label: 'Pune', point: { type: 'Point', coordinates: [73, 18] }, updatedAt: new Date() };
    profile.lastActiveAt = new Date();

    // OFF — wipes the published anchor and the activity stamp atomically.
    res = resStub();
    await call(main.updateSettings, { body: { discoverable: false }, user: { userId: 'u1' } }, res);
    assert.equal(profile.settings.discoverable, false);
    assert.equal(profile.settings.discoveryConsent, false);
    assert.equal(profile.lastActiveAt, null);
    assert.equal(profile.home.city, '');
    // The empty point subdoc is dropped by the pre-save hook on a real
    // save — with save stubbed, assert the coordinates are gone instead.
    assert.equal(profile.home.point?.coordinates, undefined);
  } finally {
    OpenNetworkProfile.getOrCreate = origGet;
  }
});

test('leave clears consent, home and activity', async () => {
  const profile = new OpenNetworkProfile({ userId: 'u2' });
  profile.joined = true;
  profile.settings.discoverable = true;
  profile.settings.discoveryConsent = true;
  profile.home = { city: 'Pune', point: { type: 'Point', coordinates: [73, 18] }, updatedAt: new Date() };
  profile.lastActiveAt = new Date();
  const origGet = OpenNetworkProfile.getOrCreate;
  OpenNetworkProfile.getOrCreate = async () => profile;
  try {
    const res = resStub();
    await call(main.leaveOpenNetwork, { user: { userId: 'u2' } }, res);
    assert.equal(profile.joined, false);
    assert.equal(profile.settings.discoverable, false);
    assert.equal(profile.settings.discoveryConsent, false);
    assert.equal(profile.lastActiveAt, null);
    assert.equal(profile.home.city, '');
  } finally {
    OpenNetworkProfile.getOrCreate = origGet;
  }
});

test('presence requires consent and writes atomically under the discovery filter', async () => {
  let capturedFilter = null;
  let capturedSet = null;
  const origUpdate = OpenNetworkProfile.updateOne;
  OpenNetworkProfile.updateOne = async (filter, update) => {
    capturedFilter = filter;
    capturedSet = update.$set;
    return { matchedCount: 1 };
  };
  const profile = new OpenNetworkProfile({ userId: 'u3' });
  profile.joined = true;
  profile.settings.discoverable = true;
  profile.settings.discoveryConsent = true;
  try {
    const res = resStub();
    await social.updatePresence(
      { body: { lng: '73.86', lat: '18.52' }, openNetworkProfile: profile, user: { userId: 'u3' } },
      res,
      () => {},
    );
    assert.equal(res.body.success, true);
    assert.equal(res.body.published, true);
    // The conditional write carries the whole consent filter — a request
    // that lands after opt-out matches nothing and cannot restore home.
    assert.equal(capturedFilter.joined, true);
    assert.equal(capturedFilter['settings.discoverable'], true);
    assert.equal(capturedFilter['settings.discoveryConsent'], true);
    // Only the snapped point reaches the geocoder/store — never the precise fix.
    const clng = capturedSet['home.point'].coordinates[0];
    const clat = capturedSet['home.point'].coordinates[1];
    assert.ok(Math.abs(clng - 73.86) >= 0.001 || Math.abs(clat - 18.52) >= 0.001);
    assert.equal(capturedSet['home.lng'], clng);
    assert.equal(capturedSet['home.lat'], clat);
    assert.equal(resolvePlaceCalls > 0, true);
  } finally {
    OpenNetworkProfile.updateOne = origUpdate;
  }
});

test('presence without consent rejects before any geocode or write', async () => {
  let writes = 0;
  const origUpdate = OpenNetworkProfile.updateOne;
  OpenNetworkProfile.updateOne = async () => {
    writes += 1;
    return { matchedCount: 0 };
  };
  const geocodesBefore = resolvePlaceCalls;
  const profile = new OpenNetworkProfile({ userId: 'u4' });
  profile.joined = true; // joined but discoverable/consent false
  try {
    const e = await call(
      social.updatePresence,
      { body: { lng: 73.86, lat: 18.52 }, openNetworkProfile: profile, user: { userId: 'u4' } },
      resStub(),
    );
    assert.equal(e?.code, 'PRESENCE_DISABLED');
    assert.equal(writes, 0); // never reaches the write
    assert.equal(resolvePlaceCalls, geocodesBefore); // never geocodes
  } finally {
    OpenNetworkProfile.updateOne = origUpdate;
  }
});

test('a stale ping that matched nothing reports PRESENCE_DISABLED, not success', async () => {
  // Profile read as consented, but the member opted out before the
  // conditional write landed — matchedCount:0 means nothing published.
  const origUpdate = OpenNetworkProfile.updateOne;
  OpenNetworkProfile.updateOne = async () => ({ matchedCount: 0 });
  const profile = new OpenNetworkProfile({ userId: 'u4b' });
  profile.joined = true;
  profile.settings.discoverable = true;
  profile.settings.discoveryConsent = true;
  try {
    const e = await call(
      social.updatePresence,
      { body: { lng: 73.86, lat: 18.52 }, openNetworkProfile: profile, user: { userId: 'u4b' } },
      resStub(),
    );
    assert.equal(e?.code, 'PRESENCE_DISABLED');
  } finally {
    OpenNetworkProfile.updateOne = origUpdate;
  }
});

test('presence rejects non-numeric/out-of-range coords but keeps zero', async () => {
  const profile = new OpenNetworkProfile({ userId: 'u5' });
  profile.joined = true;
  profile.settings.discoverable = true;
  profile.settings.discoveryConsent = true;
  for (const body of [{ lng: '', lat: 1 }, { lng: true, lat: 1 }, { lng: [], lat: 1 }, { lng: 'abc', lat: 1 }, { lng: 200, lat: 1 }, { lng: 1, lat: -95 }, {}]) {
    const e = await call(
      social.updatePresence,
      { body, openNetworkProfile: profile, user: { userId: 'u5' } },
      resStub(),
    );
    assert.equal(e?.code, 'BAD_LOCATION', JSON.stringify(body));
  }
  // Zero is a real coordinate (Gulf of Guinea) — must not be falsy-rejected.
  const origUpdate = OpenNetworkProfile.updateOne;
  OpenNetworkProfile.updateOne = async () => ({ matchedCount: 1 });
  try {
    const res = resStub();
    const e = await call(
      social.updatePresence,
      { body: { lng: 0, lat: 0 }, openNetworkProfile: profile, user: { userId: 'u5' } },
      res,
    );
    assert.equal(e, null);
    assert.equal(res.body.success, true);
  } finally {
    OpenNetworkProfile.updateOne = origUpdate;
  }
});

test('people list carries the full discovery filter + 24h activity window', async () => {
  let capturedQuery = null;
  const origAgg = OpenNetworkProfile.aggregate;
  OpenNetworkProfile.aggregate = async (pipeline) => {
    capturedQuery = pipeline[0].$geoNear.query;
    return [];
  };
  stubCtx = { friendIds: new Set(), blockedIds: new Set(['blocked1']), pageIds: new Set() };
  const profile = new OpenNetworkProfile({ userId: 'me' });
  try {
    const res = resStub();
    await social.listPeople(
      { query: { lng: '10', lat: '20' }, openNetworkProfile: profile, user: { userId: 'me', _id: 'x' } },
      res,
      () => {},
    );
    assert.equal(capturedQuery.joined, true);
    assert.equal(capturedQuery['settings.discoverable'], true);
    assert.equal(capturedQuery['settings.discoveryConsent'], true);
    assert.deepEqual(capturedQuery.userId.$nin, ['blocked1']);
    const cutoff = Date.now() - capturedQuery.lastActiveAt.$gte.getTime();
    // 24h ± slack — the 30-day window is gone.
    assert.ok(cutoff > 23 * 3600 * 1000 && cutoff < 25 * 3600 * 1000);
  } finally {
    OpenNetworkProfile.aggregate = origAgg;
  }
});

test('people browsing without consent cannot reuse a legacy home origin', async () => {
  const profile = new OpenNetworkProfile({ userId: 'me2' });
  profile.joined = true;
  // Legacy leftovers: a home anchor but no consent.
  profile.home = { city: 'Old', point: { type: 'Point', coordinates: [10, 20] }, updatedAt: new Date() };
  const res = resStub();
  const e = await call(
    social.listPeople,
    { query: {}, openNetworkProfile: profile, user: { userId: 'me2', _id: 'x' } },
    res,
  );
  assert.equal(e?.code, 'LOCATION_REQUIRED');
});

test('people list rejects a half/invalid supplied point instead of falling back', async () => {
  // A viewer WITH a valid anchor still can't pass half a coordinate — the
  // home fallback exists only for a call that supplies neither.
  const profile = new OpenNetworkProfile({ userId: 'me3' });
  profile.joined = true;
  profile.settings.discoverable = true;
  profile.settings.discoveryConsent = true;
  profile.home = { city: 'Home', point: { type: 'Point', coordinates: [10, 20] }, updatedAt: new Date() };
  for (const query of [
    { lng: '10' },             // missing lat
    { lat: '20' },             // missing lng
    { lng: 'abc', lat: '20' }, // non-numeric
    { lng: '200', lat: '20' }, // out of range
    { lng: '', lat: '20' },    // blank
  ]) {
    const e = await call(
      social.listPeople,
      { query, openNetworkProfile: profile, user: { userId: 'me3', _id: 'x' } },
      resStub(),
    );
    assert.equal(e?.code, 'BAD_LOCATION', JSON.stringify(query));
  }
  // A fully valid pair still coarsens + browses.
  const origAgg = OpenNetworkProfile.aggregate;
  OpenNetworkProfile.aggregate = async () => [];
  try {
    const res = resStub();
    const e = await call(
      social.listPeople,
      { query: { lng: '0', lat: '0' }, openNetworkProfile: profile, user: { userId: 'me3', _id: 'x' } },
      res,
    );
    assert.equal(e, null);
    assert.equal(res.body.success, true);
  } finally {
    OpenNetworkProfile.aggregate = origAgg;
  }
});

test('people heat excludes blocked members and applies consent + 24h window', async () => {
  let capturedMatch = null;
  const origAgg = OpenNetworkProfile.aggregate;
  OpenNetworkProfile.aggregate = async (pipeline) => {
    capturedMatch = pipeline[0].$match;
    return [];
  };
  stubCtx = { friendIds: new Set(), blockedIds: new Set(['b1', 'b2']), pageIds: new Set() };
  try {
    await social.peopleHeat(
      { query: { swLng: '-10', swLat: '-10', neLng: '10', neLat: '10' }, user: { userId: 'h', _id: 'x' } },
      resStub(),
      () => {},
    );
    assert.equal(capturedMatch['settings.discoverable'], true);
    assert.equal(capturedMatch['settings.discoveryConsent'], true);
    assert.deepEqual(capturedMatch.userId.$nin, ['b1', 'b2']);
  } finally {
    OpenNetworkProfile.aggregate = origAgg;
  }
});

test('chatWith rejects a blocked peer before any connection lookup', async () => {
  let connLookups = 0;
  const origFind = OpenConnection.findOne;
  OpenConnection.findOne = () => {
    connLookups += 1;
    return { lean: async () => null };
  };
  stubCtx = { friendIds: new Set(), blockedIds: new Set(['peer']), pageIds: new Set() };
  const origExists = OpenNetworkProfile.exists;
  OpenNetworkProfile.exists = async () => ({ _id: 'p' });
  try {
    const e = await call(
      social.chatWith,
      { params: { userId: 'peer' }, user: { userId: 'me', _id: 'x' } },
      resStub(),
    );
    assert.equal(e?.code, 'PERSON_NOT_FOUND');
    assert.equal(connLookups, 0);
  } finally {
    OpenConnection.findOne = origFind;
    OpenNetworkProfile.exists = origExists;
  }
});

test('accept cannot open a chat or notify after the peer left', async () => {
  const conn = {
    _id: 'c1', requesterId: 'gone', recipientId: 'me', pairKey: 'gone|me',
    status: 'pending',
  };
  const origFindById = OpenConnection.findById;
  OpenConnection.findById = async () => conn;
  const origExists = OpenNetworkProfile.exists;
  // Peer left Open Network — exists() matches nothing.
  OpenNetworkProfile.exists = async () => null;
  stubCtx = { friendIds: new Set(), blockedIds: new Set(), pageIds: new Set() };
  notifyCalls = 0;
  try {
    const e = await call(
      social.acceptConnectionEndpoint,
      { params: { id: '507f1f77bcf86cd799439011' }, user: { userId: 'me', _id: 'x' } },
      resStub(),
    );
    assert.equal(e?.code, 'PERSON_NOT_FOUND');
    assert.equal(conn.status, 'pending'); // untouched — no accept, no chat
    assert.equal(notifyCalls, 0);
  } finally {
    OpenConnection.findById = origFindById;
    OpenNetworkProfile.exists = origExists;
  }
});

test('a pending stranger cannot open a chat — no implicit connection', async () => {
  // Peer is joined + unblocked, so requireAvailablePeer passes — but the only
  // connection row is 'pending', and they aren't Syncup friends.
  const origFind = OpenConnection.findOne;
  OpenConnection.findOne = (q) => {
    assert.equal(q.status, 'accepted'); // pending rows never match
    return { lean: async () => null };
  };
  const origExists = OpenNetworkProfile.exists;
  OpenNetworkProfile.exists = async () => ({ _id: 'p' });
  let chatLookups = 0;
  const origChat = OpenChat.findOrCreate;
  OpenChat.findOrCreate = async () => {
    chatLookups += 1;
    return { _id: 'chatX', participants: [], archivedBy: [] };
  };
  stubCtx = { friendIds: new Set(), blockedIds: new Set(), pageIds: new Set() };
  try {
    const e = await call(
      social.chatWith,
      { params: { userId: 'stranger' }, user: { userId: 'me', _id: 'x' } },
      resStub(),
    );
    assert.equal(e?.code, 'NOT_CONNECTED');
    assert.equal(chatLookups, 0);
  } finally {
    OpenConnection.findOne = origFind;
    OpenNetworkProfile.exists = origExists;
    OpenChat.findOrCreate = origChat;
  }
});

test('accepted pair can still chat even if now undiscoverable', async () => {
  const conn = {
    _id: 'c2', requesterId: 'peer', recipientId: 'me', pairKey: 'me|peer',
    status: 'accepted',
  };
  const origFind = OpenConnection.findOne;
  OpenConnection.findOne = () => ({ lean: async () => conn });
  const origExists = OpenNetworkProfile.exists;
  OpenNetworkProfile.exists = async () => ({ _id: 'p' });
  const origChat = OpenChat.findOrCreate;
  OpenChat.findOrCreate = async () => ({ _id: 'chat1', participants: ['me', 'peer'], archivedBy: [] });
  stubCtx = { friendIds: new Set(), blockedIds: new Set(), pageIds: new Set() };
  try {
    const res = resStub();
    await social.chatWith({ params: { userId: 'peer' }, user: { userId: 'me', _id: 'x' } }, res, () => {});
    assert.equal(res.body.success, true);
    assert.equal(res.body.chatId, 'chat1');
  } finally {
    OpenConnection.findOne = origFind;
    OpenNetworkProfile.exists = origExists;
    OpenChat.findOrCreate = origChat;
  }
});

test('draft Ripples are never visible by link to non-hosts', () => {
  const ctx = { friendIds: new Set(['viewer']), blockedIds: new Set(), pageIds: new Set() };
  const draft = { lifecycle: 'draft', hostUserId: 'host', visibility: 'public' };
  assert.equal(canView(draft, null, ctx, 'viewer'), false);
  assert.equal(canView(draft, null, ctx, 'host'), true);
  // Even a friend or an invited member stays out of a draft.
  assert.equal(canView(draft, { status: 'approved' }, ctx, 'viewer'), false);
});

test('createRipple rejects bad request-body coords but keeps zero + online', async () => {
  const rippleCtl = require('../controllers/rippleController');
  const Ripple = require('../models/Ripple');
  // Sentinel: reaching this means coord validation already passed.
  const origCount = Ripple.countDocuments;
  const dbError = new Error('reached');
  dbError.code = 'DB_REACHED';
  Ripple.countDocuments = async () => {
    throw dbError;
  };
  const req = (body) => ({
    body,
    user: { userId: 'h', _id: 'x' },
    get: () => null,
  });
  const base = { title: 'A valid title', kind: 'ripple', type: 'activity' };
  try {
    for (const body of [
      { ...base, lng: '', lat: 1 },
      { ...base, lng: true, lat: 1 },
      { ...base, lng: [], lat: 1 },
      { ...base, lng: 'abc', lat: 1 },
      { ...base, lng: 200, lat: 1 },
      { ...base, lat: 1 },           // missing lng
      { ...base, lng: 1 },           // missing lat
    ]) {
      const e = await call(rippleCtl.createRipple, req(body), resStub());
      assert.equal(e?.code, 'VALIDATION', JSON.stringify(body));
    }
    // Zero coords are valid — the request must get PAST the coord check
    // (it dies at the stubbed DB layer, proving the parse accepted them).
    const e0 = await call(
      rippleCtl.createRipple,
      req({ ...base, lng: '0', lat: '0' }),
      resStub(),
    );
    assert.equal(e0?.code, 'DB_REACHED');
    // Online reach publishes no coordinates at all — also reaches the DB layer.
    const eOn = await call(
      rippleCtl.createRipple,
      req({ ...base, reach: 'online' }),
      resStub(),
    );
    assert.equal(eOn?.code, 'DB_REACHED');
  } finally {
    Ripple.countDocuments = origCount;
  }
});

test('getNearby rejects non-numeric/out-of-range coords but keeps zero', async () => {
  const Ripple = require('../models/Ripple');
  const origAgg = Ripple.aggregate;
  Ripple.aggregate = async () => [];
  try {
    for (const q of [{ lng: '', lat: 1 }, { lng: true, lat: 1 }, { lng: 'abc', lat: 1 }, { lng: 300, lat: 1 }, { lat: 1 }]) {
      const e = await call(
        main.getNearby,
        { query: q, user: { userId: 'u', _id: 'x' } },
        resStub(),
      );
      assert.equal(e?.code, 'BAD_COORDS', JSON.stringify(q));
    }
    const res = resStub();
    const e = await call(
      main.getNearby,
      { query: { lng: '0', lat: '0' }, user: { userId: 'u', _id: 'x' } },
      res,
    );
    assert.equal(e, null);
    assert.equal(res.body.success, true);
  } finally {
    Ripple.aggregate = origAgg;
  }
});
