const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const crypto = require('node:crypto');
const { ed25519 } = require('@noble/curves/ed25519');

// --- In-memory E2EEDevice model fake --------------------------------------
const makeDeviceStore = () => {
  const docs = new Map(); // `${userId}|${deviceId}` -> doc
  const clone = (d) => (d ? JSON.parse(JSON.stringify(d)) : d);
  const key = (u, d) => `${u}|${d}`;
  const asDoc = (d) => {
    const doc = clone(d);
    doc.save = async () => { docs.set(key(doc.userId, doc.deviceId), clone(doc)); return doc; };
    return doc;
  };
  return {
    docs,
    findOne: async (filter) => {
      for (const d of docs.values()) {
        if (d.userId === filter.userId && d.deviceId === filter.deviceId &&
            (filter.revokedAt === undefined || (filter.revokedAt === null && d.revokedAt === null))) {
          return asDoc(d);
        }
      }
      return null;
    },
    countDocuments: async (filter) => {
      let n = 0;
      for (const d of docs.values()) {
        if (d.userId === filter.userId && (filter.revokedAt !== null || d.revokedAt === null)) n++;
      }
      return n;
    },
    findOneAndUpdate: async (filter, update) => {
      const doc = { ...(docs.get(key(filter.userId, filter.deviceId)) || {}), ...update.$set };
      docs.set(key(filter.userId, filter.deviceId), doc);
      return clone(doc);
    },
    find: (filter) => ({
      select: () => ({
        lean: async () =>
          [...docs.values()]
            .filter(d => d.userId === filter.userId && (filter.revokedAt !== null || d.revokedAt === null))
            .map(d => ({ deviceId: d.deviceId, identityKey: d.identityKey, signedPreKey: d.signedPreKey, capabilities: d.capabilities || [] })),
      }),
    }),
  };
};

const loadController = (mocks) => {
  const modulePath = require.resolve('../controllers/e2eeController');
  const originalLoad = Module._load;
  const cachedModule = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cachedModule) require.cache[modulePath] = cachedModule;
    else delete require.cache[modulePath];
  }
};

const res = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

// --- Helpers to build a valid bundle ---------------------------------------
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const makeIdentity = () => {
  const priv = crypto.getRandomValues(new Uint8Array(32));
  return { priv, pub: ed25519.getPublicKey(priv) };
};
const makeBundle = (identity, deviceId, spkId = 1) => {
  const spkPriv = crypto.getRandomValues(new Uint8Array(32));
  const { x25519 } = require('@noble/curves/ed25519');
  const spkPub = x25519.getPublicKey(spkPriv);
  const prefix = Buffer.from(`SYNCUP-SPK-v2|${deviceId}|${spkId}|`, 'utf8');
  const sig = ed25519.sign(Buffer.concat([prefix, Buffer.from(spkPub)]), identity.priv);
  return {
    deviceId,
    identityKey: b64(identity.pub),
    signedPreKey: { id: spkId, publicKey: b64(spkPub), signature: b64(sig) },
  };
};

const userA = 'user-aaaa';
const userB = 'user-bbbb';
const deviceA = 'a'.repeat(32);
const deviceB = 'b'.repeat(32);

const loadWithStore = () => {
  const store = makeDeviceStore();
  const controller = loadController({
    '../models/E2EEDevice': store,
    '../models/blockModel': { isMutuallyBlocked: async () => ({ anyBlocked: false }) },
  });
  return { store, controller };
};

test('registerDevice accepts a valid bundle', async () => {
  const { store, controller } = loadWithStore();
  const identity = makeIdentity();
  const bundle = makeBundle(identity, deviceA);
  const response = res();
  await controller.registerDevice({ body: bundle, user: { userId: userA } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(store.docs.size, 1);
});

test('registerDevice rejects a bad SPK signature', async () => {
  const { controller } = loadWithStore();
  const identity = makeIdentity();
  const bundle = makeBundle(identity, deviceA);
  bundle.signedPreKey.signature = b64(crypto.getRandomValues(new Uint8Array(64)));
  const response = res();
  await controller.registerDevice({ body: bundle, user: { userId: userA } }, response);
  assert.equal(response.statusCode, 400);
});

test('registerDevice rejects malformed key material', async () => {
  const { controller } = loadWithStore();
  const identity = makeIdentity();
  const bundle = makeBundle(identity, deviceA);
  bundle.identityKey = b64(new Uint8Array(31)); // wrong length
  let response = res();
  await controller.registerDevice({ body: bundle, user: { userId: userA } }, response);
  assert.equal(response.statusCode, 400);

  response = res();
  await controller.registerDevice(
    { body: { ...bundle, identityKey: b64(identity.pub), deviceId: 'not-hex' }, user: { userId: userA } },
    response
  );
  assert.equal(response.statusCode, 400);

  // Non-canonical base64 (Buffer.from would still decode it)
  response = res();
  await controller.registerDevice(
    { body: { ...bundle, identityKey: `${b64(identity.pub)}!?` }, user: { userId: userA } },
    response
  );
  assert.equal(response.statusCode, 400);
});

test('registerDevice refuses an identity key change', async () => {
  const { controller } = loadWithStore();
  const identity = makeIdentity();
  await controller.registerDevice(
    { body: makeBundle(identity, deviceA), user: { userId: userA } }, res());

  const otherIdentity = makeIdentity();
  const response = res();
  await controller.registerDevice(
    { body: makeBundle(otherIdentity, deviceA), user: { userId: userA } }, response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, 'IDENTITY_IMMUTABLE');
});

test('registerDevice enforces the 5 active device limit', async () => {
  const { controller } = loadWithStore();
  const identity = makeIdentity();
  for (let i = 0; i < 5; i++) {
    const r = res();
    await controller.registerDevice(
      { body: makeBundle(identity, (i + 1).toString(16).repeat(32)), user: { userId: userA } }, r);
    assert.equal(r.statusCode, 200, `device ${i} should register`);
  }
  // Re-registering an existing device still works past the limit
  const reReg = res();
  await controller.registerDevice(
    { body: makeBundle(identity, '11111111111111111111111111111111'), user: { userId: userA } }, reReg);
  assert.equal(reReg.statusCode, 200);

  const sixth = res();
  await controller.registerDevice(
    { body: makeBundle(identity, '99999999999999999999999999999999'), user: { userId: userA } }, sixth);
  assert.equal(sixth.statusCode, 409);
  assert.equal(sixth.body.code, 'DEVICE_LIMIT');
});

test('rotateSignedPreKey requires a higher id and a valid signature', async () => {
  const { store, controller } = loadWithStore();
  const identity = makeIdentity();
  await controller.registerDevice(
    { body: makeBundle(identity, deviceA), user: { userId: userA } }, res());

  // Lower/equal id rejected
  const lowRes = res();
  const lowBundle = makeBundle(identity, deviceA, 1).signedPreKey;
  await controller.rotateSignedPreKey(
    { params: { deviceId: deviceA }, body: { signedPreKey: lowBundle }, user: { userId: userA } }, lowRes);
  assert.equal(lowRes.statusCode, 400);

  // Higher id with bad signature rejected
  const badSig = res();
  const spk2 = makeBundle(identity, deviceA, 2).signedPreKey;
  spk2.signature = b64(crypto.getRandomValues(new Uint8Array(64)));
  await controller.rotateSignedPreKey(
    { params: { deviceId: deviceA }, body: { signedPreKey: spk2 }, user: { userId: userA } }, badSig);
  assert.equal(badSig.statusCode, 400);

  // Higher id + valid signature accepted
  const ok = res();
  const spk3 = makeBundle(identity, deviceA, 2).signedPreKey;
  await controller.rotateSignedPreKey(
    { params: { deviceId: deviceA }, body: { signedPreKey: spk3 }, user: { userId: userA } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(store.docs.get(`${userA}|${deviceA}`).signedPreKey.id, 2);
});

test('another user cannot rotate or delete a device they do not own', async () => {
  const { controller } = loadWithStore();
  const identity = makeIdentity();
  await controller.registerDevice(
    { body: makeBundle(identity, deviceA), user: { userId: userA } }, res());

  const rotate = res();
  await controller.rotateSignedPreKey(
    { params: { deviceId: deviceA }, body: { signedPreKey: makeBundle(identity, deviceA, 2).signedPreKey }, user: { userId: userB } }, rotate);
  assert.equal(rotate.statusCode, 404);

  const del = res();
  await controller.revokeDevice(
    { params: { deviceId: deviceA }, user: { userId: userB } }, del);
  assert.equal(del.statusCode, 404);
});

test('getUserDevices returns empty list when users are mutually blocked', async () => {
  const store = makeDeviceStore();
  const controller = loadController({
    '../models/E2EEDevice': store,
    '../models/blockModel': { isMutuallyBlocked: async () => ({ anyBlocked: true }) },
  });
  const identity = makeIdentity();
  await controller.registerDevice(
    { body: makeBundle(identity, deviceA), user: { userId: userA } }, res());

  const response = res();
  await controller.getUserDevices(
    { params: { userId: userA }, user: { userId: userB } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, []);
});

test('getUserDevices lists active devices only', async () => {
  const { store, controller } = loadWithStore();
  const identity = makeIdentity();
  await controller.registerDevice(
    { body: makeBundle(identity, deviceA), user: { userId: userA } }, res());
  await controller.registerDevice(
    { body: makeBundle(identity, deviceB), user: { userId: userA } }, res());
  await controller.revokeDevice({ params: { deviceId: deviceB }, user: { userId: userA } }, res());

  const response = res();
  await controller.getUserDevices(
    { params: { userId: userA }, user: { userId: userB } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.data[0].deviceId, deviceA);
});

test('registerDevice stores capabilities on the device record', async () => {
  const { store, controller } = loadWithStore();
  const identity = makeIdentity();
  const bundle = { ...makeBundle(identity, deviceA), capabilities: ['call-livekit-e2ee-v1'] };
  const response = res();
  await controller.registerDevice({ body: bundle, user: { userId: userA } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(store.docs.get(`${userA}|${deviceA}`).capabilities, ['call-livekit-e2ee-v1']);

  // getUserDevices surfaces them to callers negotiating transports
  const list = res();
  await controller.getUserDevices({ params: { userId: userA }, user: { userId: userB } }, list);
  assert.deepEqual(list.body.data[0].capabilities, ['call-livekit-e2ee-v1']);
});

test('registerDevice validates capabilities', async () => {
  const { controller } = loadWithStore();
  const identity = makeIdentity();
  const good = makeBundle(identity, deviceA);
  for (const bad of [
    'call-livekit-e2ee-v1',                 // not an array
    Array(11).fill('ok-cap'),               // > 10 entries
    ['UPPER_CASE'],                         // charset violated
    ['x'.repeat(41)],                       // > 40 chars
    [42],                                   // non-string
  ]) {
    const response = res();
    await controller.registerDevice(
      { body: { ...good, capabilities: bad }, user: { userId: userA } }, response);
    assert.equal(response.statusCode, 400, `should reject ${JSON.stringify(bad)}`);
    assert.match(response.body.message, /capabilities/);
  }
  // No capabilities field → existing behavior unchanged (200)
  const response = res();
  await controller.registerDevice({ body: good, user: { userId: userA } }, response);
  assert.equal(response.statusCode, 200);
});
