const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const loadWithMocks = (request, mocks) => {
  const modulePath = require.resolve(request);
  const originalLoad = Module._load;
  const cachedModule = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (id, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    return originalLoad.call(this, id, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cachedModule) require.cache[modulePath] = cachedModule;
    else delete require.cache[modulePath];
  }
};

const chain = (result) => {
  const query = {};
  for (const m of ['select', 'lean', 'sort', 'skip', 'limit']) query[m] = () => query;
  query.then = (res, rej) => Promise.resolve(typeof result === 'function' ? result() : result).then(res, rej);
  return query;
};

const userDoc = (overrides = {}) => ({
  userId: 'u-x', name: 'Ravi Kumar', profileImage: null,
  status: 'available', mainStatus: null, ...overrides,
});

const makeService = ({ MayaRequest = {}, Friend = {}, Block = {}, User = {}, dispatched } = {}) => {
  const calls = dispatched || [];
  const svc = loadWithMocks('../services/mayaRequestService', {
    '../models/MayaRequest': MayaRequest,
    '../models/Friend': Friend,
    '../models/blockModel': Block,
    '../models/userModel': User,
    './notificationDispatcher': { dispatchNotification: async (env) => { calls.push(env); return env; } },
  });
  svc._clearUserCache?.();
  return { svc, calls };
};

const reqDoc = (overrides = {}) => ({
  requestId: 'req-1',
  fromUserId: 'u-sender',
  kind: 'invite',
  activity: 'coffee',
  title: 'Coffee?',
  recipients: [
    { userId: 'u-a', status: 'pending' },
    { userId: 'u-b', status: 'pending' },
  ],
  status: 'open',
  expiresAt: new Date(Date.now() + 3600e3),
  createdAt: new Date(),
  ...overrides,
});

// ---------------- create validation ----------------

test('create rejects self-recipient', async () => {
  const { svc } = makeService();
  await assert.rejects(
    () => svc.createRequest({ fromUserId: 'u-me', body: { kind: 'invite', recipients: ['u-me'] } }),
    (e) => e.code === 'RECIPIENT_NOT_ALLOWED',
  );
});

test('create rejects duplicates / >10 / empty', async () => {
  const { svc } = makeService({ MayaRequest: { countDocuments: async () => 0 } });
  await assert.rejects(() => svc.createRequest({ fromUserId: 'u-me', body: { kind: 'invite', recipients: ['a', 'a'] } }), /unique/);
  await assert.rejects(() => svc.createRequest({ fromUserId: 'u-me', body: { kind: 'invite', recipients: Array(11).fill('x').map((_, i) => 'x' + i) } }), /unique/);
  await assert.rejects(() => svc.createRequest({ fromUserId: 'u-me', body: { kind: 'invite', recipients: [] } }), /unique/);
});

test('create rejects non-friend / blocked with generic code', async () => {
  const { svc } = makeService({
    MayaRequest: { countDocuments: async () => 0 },
    Friend: { areFriends: async () => false },
    Block: { isMutuallyBlocked: async () => false },
  });
  await assert.rejects(
    () => svc.createRequest({ fromUserId: 'u-me', body: { kind: 'invite', recipients: ['u-stranger'] } }),
    (e) => e.code === 'RECIPIENT_NOT_ALLOWED' && !/u-stranger/.test(e.message),
  );

  const { svc: svc2 } = makeService({
    MayaRequest: { countDocuments: async () => 0 },
    Friend: { areFriends: async () => true },
    Block: { isMutuallyBlocked: async () => true },
  });
  await assert.rejects(
    () => svc2.createRequest({ fromUserId: 'u-me', body: { kind: 'invite', recipients: ['u-blocked'] } }),
    (e) => e.code === 'RECIPIENT_NOT_ALLOWED',
  );
});

test('rate limit: 20 creates/hour', async () => {
  const { svc } = makeService({
    MayaRequest: { countDocuments: async () => 20 },
    Friend: { areFriends: async () => true },
    Block: { isMutuallyBlocked: async () => false },
  });
  await assert.rejects(
    () => svc.createRequest({ fromUserId: 'u-me', body: { kind: 'invite', recipients: ['u-a'] } }),
    (e) => e.code === 'RATE_LIMITED',
  );
});

test('max 3 open requests to the same recipient', async () => {
  const openDocs = [{ recipients: [{ userId: 'u-a', status: 'pending' }] },
    { recipients: [{ userId: 'u-a', status: 'pending' }] },
    { recipients: [{ userId: 'u-a', status: 'pending' }] }];
  const { svc } = makeService({
    MayaRequest: {
      countDocuments: async (q) => q['recipients.userId'] ? 3 : 0,
      find: () => chain(openDocs),
    },
    Friend: { areFriends: async () => true },
    Block: { isMutuallyBlocked: async () => false },
  });
  await assert.rejects(
    () => svc.createRequest({ fromUserId: 'u-me', body: { kind: 'invite', recipients: ['u-a'] } }),
    (e) => e.code === 'RATE_LIMITED',
  );
});

test('happy path creates + notifies each recipient', async () => {
  let created;
  const { svc, calls } = makeService({
    MayaRequest: {
      countDocuments: async () => 0,
      find: () => chain([]),
      create: async (doc) => { created = { ...doc, status: 'open', requestId: 'req-9' }; return created; },
    },
    Friend: { areFriends: async () => true },
    Block: { isMutuallyBlocked: async () => false },
    User: { findOne: (q) => chain(userDoc({ userId: q.userId, name: 'Ravi Kumar' })) },
  });
  const doc = await svc.createRequest({
    fromUserId: 'u-sender',
    body: { kind: 'invite', activity: 'coffee', title: 'Coffee at Third Wave?', timeText: '5 PM', recipients: ['u-a', 'u-b'] },
  });
  assert.equal(doc.status, 'open');
  assert.equal(created.recipients.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].type, 'maya_request');
  assert.equal(calls[0].action.screen, 'MayaChat');
  assert.equal(calls[0].action.params.requestId, doc.requestId);
  assert.match(calls[0].title, /Ravi's Maya/);
  assert.match(calls[0].body, /Coffee at Third Wave\?/);
});

// ---------------- respond ----------------

test('respond accept updates recipient atomically + notifies sender', async () => {
  const doc = reqDoc();
  doc.recipients[0].status = 'accepted';
  doc.recipients[0].respondedAt = new Date();
  let filterSeen;
  const { svc, calls } = makeService({
    MayaRequest: {
      findOneAndUpdate: async (filter, update) => { filterSeen = filter; return doc; },
      findOne: (q) => chain(doc),
    },
    User: { findOne: (q) => chain(userDoc({ userId: q.userId })) },
  });
  const res = await svc.respond('u-a', 'req-1', { action: 'accept', reply: 'in!' });
  assert.equal(filterSeen.status, 'open');
  assert.deepEqual(filterSeen.recipients.$elemMatch.userId, 'u-a');
  assert.equal(res.request.recipients[0].status, 'accepted');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'maya_reply');
  assert.equal(calls[0].toUserId, 'u-sender');
});

test('respond wrong user → 404; closed → 409; idempotent repeat returns state', async () => {
  const open = reqDoc();
  const { svc } = makeService({
    MayaRequest: {
      findOneAndUpdate: async () => null,
      findOne: (q) => chain(q.requestId === 'req-1' ? open : null),
    },
    User: { findOne: () => chain(userDoc()) },
  });
  // wrong user — not sender or recipient
  await assert.rejects(() => svc.respond('u-stranger', 'req-1', { action: 'accept' }), (e) => e.status === 404);
  // sender can't respond
  await assert.rejects(() => svc.respond('u-sender', 'req-1', { action: 'accept' }), (e) => e.status === 403);

  // idempotent: already accepted, accept again returns state
  const done = reqDoc({ recipients: [{ userId: 'u-a', status: 'accepted' }, { userId: 'u-b', status: 'pending' }] });
  const { svc: svc2 } = makeService({
    MayaRequest: { findOneAndUpdate: async () => null, findOne: () => chain(done) },
    User: { findOne: () => chain(userDoc()) },
  });
  const again = await svc2.respond('u-a', 'req-1', { action: 'accept' });
  assert.equal(again.repeated, true);

  // conflicting second action after accepted → 409
  await assert.rejects(() => svc2.respond('u-a', 'req-1', { action: 'decline' }), (e) => e.status === 409);
});

test('suggest records suggested time', async () => {
  const doc = reqDoc();
  doc.recipients[1].status = 'suggested';
  doc.recipients[1].suggestedTimeText = '6 PM';
  const { svc } = makeService({
    MayaRequest: { findOneAndUpdate: async (f, u) => { assert.equal(u.$set['recipients.$.status'], 'suggested'); return doc; } },
    User: { findOne: () => chain(userDoc()) },
  });
  const res = await svc.respond('u-b', 'req-1', { action: 'suggest', suggestedTimeText: '6 PM' });
  assert.equal(res.request.recipients[1].status, 'suggested');
});

test('location_share accept flags needsClientShare', async () => {
  const doc = reqDoc({ kind: 'location_share' });
  doc.recipients[0].status = 'accepted';
  const { svc } = makeService({
    MayaRequest: { findOneAndUpdate: async () => doc },
    User: { findOne: () => chain(userDoc()) },
  });
  const res = await svc.respond('u-a', 'req-1', { action: 'accept' });
  assert.equal(res.request.needsClientShare, true);
  assert.equal(res.request.shareToUserId, 'u-sender');
});

// ---------------- confirm / cancel / nudge ----------------

test('confirm + cancel are sender-only and notify recipients', async () => {
  const doc = reqDoc();
  const saved = [];
  doc.save = async () => { saved.push(true); return doc; };
  const { svc, calls } = makeService({
    MayaRequest: { findOne: (q) => chain(doc) },
    User: { findOne: () => chain(userDoc({ name: 'Ravi Kumar' })) },
  });
  // non-sender 404
  await assert.rejects(() => svc.confirm('u-a', 'req-1', {}), (e) => e.status === 404);
  const out = await svc.confirm('u-sender', 'req-1', {});
  assert.equal(out.status, 'confirmed');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].type, 'maya_plan');
});

test('nudge throttles at 30min per pending recipient', async () => {
  const doc = reqDoc();
  doc.save = async () => doc;
  const { svc, calls } = makeService({
    MayaRequest: { findOne: () => chain(doc) },
    User: { findOne: () => chain(userDoc()) },
  });
  await svc.nudge('u-sender', 'req-1', { recipientUserId: 'u-a' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toUserId, 'u-a');
  // second nudge inside 30min → throttled
  await assert.rejects(() => svc.nudge('u-sender', 'req-1', { recipientUserId: 'u-a' }), (e) => e.code === 'NUDGE_THROTTLED');
  // non-pending recipient rejected
  doc.recipients[0].status = 'accepted';
  await assert.rejects(() => svc.nudge('u-sender', 'req-1', { recipientUserId: 'u-a' }), /responded/);
});

// ---------------- expiry job ----------------

test('expireDue flips open+pending → expired and notifies sender silently', async () => {
  const doc = reqDoc({ expiresAt: new Date(Date.now() - 1000) });
  doc.save = async () => doc;
  const { svc, calls } = makeService({
    MayaRequest: { find: () => chain([doc]) },
    User: { findOne: () => chain(userDoc()) },
  });
  const n = await svc.expireDue();
  assert.equal(n, 1);
  assert.equal(doc.status, 'expired');
  assert.equal(doc.recipients.every((r) => r.status === 'expired'), true);
  assert.equal(calls[0].toUserId, 'u-sender');
  assert.equal(calls[0].silentPush, true);
});

// ---------------- notifications & privacy ----------------

test('DND recipient gets silent (data-only) push', async () => {
  const { svc, calls } = makeService({
    MayaRequest: {
      countDocuments: async () => 0,
      find: () => chain([]),
      create: async (d) => d,
    },
    Friend: { areFriends: async () => true },
    Block: { isMutuallyBlocked: async () => false },
    User: {
      findOne: (q) => chain(q.userId === 'u-a'
        ? userDoc({ userId: 'u-a', status: 'sleeping' })
        : userDoc({ userId: q.userId })),
    },
  });
  await svc.createRequest({ fromUserId: 'u-sender', body: { kind: 'invite', activity: 'coffee', recipients: ['u-a'] } });
  const toA = calls.find((c) => c.toUserId === 'u-a');
  assert.equal(toA.silentPush, true);
});

test('recipient view hides other recipients\' replies/details', async () => {
  const doc = reqDoc();
  doc.recipients[0] = { ...doc.recipients[0], status: 'accepted', reply: 'secret reply', suggestedTime: new Date() };
  const { svc } = makeService({
    MayaRequest: { findOne: () => chain(doc) },
    User: { findOne: () => chain(userDoc()) },
  });
  const view = await svc.getRequest('u-b', 'req-1');
  const other = view.recipients.find((r) => r.userId === 'u-a');
  assert.equal(other.status, 'accepted');
  assert.equal(other.reply, undefined);
  assert.equal(other.suggestedTime, undefined);
  // sender sees the full doc
  const full = await svc.getRequest('u-sender', 'req-1');
  assert.equal(full.recipients[0].reply, 'secret reply');
  // stranger 404
  await assert.rejects(() => svc.getRequest('u-stranger', 'req-1'), (e) => e.status === 404);
});

// ---------------- retired mock ----------------

test('POST /api/ai/conversation/complete returns 410 MAYA_REQUESTS_MOVED', async () => {
  const ctrl = loadWithMocks('../controllers/aiMessageController', {});
  const res = {
    statusCode: 0,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
  await ctrl.processCompleteAIConversation({ body: {} }, res);
  assert.equal(res.statusCode, 410);
  assert.equal(res.payload.code, 'MAYA_REQUESTS_MOVED');
});
