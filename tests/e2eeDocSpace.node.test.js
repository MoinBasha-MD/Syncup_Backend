const assert = require('node:assert/strict');
const Module = require('node:module');
const crypto = require('node:crypto');
const test = require('node:test');

const res = () => ({
  statusCode: 200,
  body: undefined,
  sentFile: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  sendFile(file, opts, cb) { this.sentFile = { file, opts }; if (cb) cb(); return this; },
});

const loadController = (mocks) => {
  const modulePath = require.resolve('../controllers/docSpaceController');
  const originalLoad = Module._load;
  const cached = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cached) require.cache[modulePath] = cached;
    else delete require.cache[modulePath];
  }
};

const owner = 'user-owner';
const grantee = 'user-grantee';
const stranger = 'user-stranger';
const docId = 'a'.repeat(32);
const blobId = 'b'.repeat(32);

const keyEntry = (userId) => ({
  userId, deviceId: userId.slice(-4).padStart(8, 'x'), spkId: 1, epk: 'C', iv: 'D', wk: 'E',
});

const envelope = (keyUsers) => ({
  v: 2,
  alg: 'x25519-hkdf-sha256-aes256gcm+ed25519',
  sender: { userId: owner, deviceId: 'd'.repeat(32) },
  ctx: `doc:${owner}:${docId}`,
  msgId: 'AAAAAAAAAAAAAAAAAAAAAA==',
  ts: 1700000000000,
  iv: 'AAAAAAAAAAAAAAAA',
  ct: 'BBBBBBBB',
  keys: keyUsers.map(keyEntry),
  sig: 'FFFF',
});

const makeDocSpace = (docs = []) => ({
  userId: owner,
  documents: docs,
  generalAccessList: [{ userId: grantee }],
  documentSpecificAccess: [],
  settings: { maxDocuments: 5 },
  addDocument: async function (data) { this.lastAdded = data; },
  save: async function () { this.saved = true; },
  logAccess: async () => {},
});

const v2Doc = (overrides = {}) => ({
  documentId: docId,
  documentType: 'Other',
  customName: '',
  fileUrl: null,
  fileType: '',
  fileSize: 0,
  e2ee: { v: 2, blobId, keyEnvelope: envelope([owner, grantee]), keyVersion: 2 },
  markModified: () => {},
  ...overrides,
});

const loadWith = (docSpaceOverrides = {}, blobResult = { blobId }, fsExtra = {}) => {
  const calls = { unlinked: [] };
  const DocSpaceMock = {
    findOne: async (q) => {
      if (docSpaceOverrides.findOneResult !== undefined) return docSpaceOverrides.findOneResult;
      const docSpace = docSpaceOverrides.docSpace;
      if (!docSpace) return null;
      return q?.userId === docSpace.userId || q?.['documents.fileUrl'] || q?.['documents.documentId']
        ? docSpace
        : docSpace;
    },
    getOrCreate: async () => docSpaceOverrides.docSpace,
    hasAccess: async (ownerId, requesterId, documentId) =>
      docSpaceOverrides.accessFor?.(requesterId, documentId) || { hasAccess: false },
  };
  const fsStub = {
    promises: {
      unlink: async (p) => { calls.unlinked.push(p); },
      readFile: async (p) => {
        if (fsExtra.readFile) return fsExtra.readFile(p);
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    },
  };
  const ctrl = loadController({
    '../models/DocSpace': DocSpaceMock,
    '../models/Blob': { findOne: async () => blobResult },
    '../models/DocumentRequest': {},
    '../models/Friend': {},
    '../models/userModel': {},
    fs: fsStub,
    '../utils/safeUploadPath': require('../utils/safeUploadPath'),
  });
  return { ctrl, calls };
};

const uploadReq = (over = {}) => ({
  user: { userId: owner, name: 'Owner' },
  body: {
    documentId: docId,
    documentType: 'Other',
    category: 'Identity',
    e2ee: { v: 2, blobId, keyEnvelope: envelope([owner, grantee]), keyVersion: 1 },
    ...over,
  },
});

test('v2 upload stores sealed record, never plaintext metadata', async () => {
  const ds = makeDocSpace([]);
  const { ctrl } = loadWith({ docSpace: ds });
  const r = res();
  await ctrl.uploadDocument(uploadReq(), r);
  assert.equal(r.statusCode, 200);
  const stored = ds.lastAdded;
  assert.equal(stored.fileUrl, null);
  assert.equal(stored.customName, '');
  assert.equal(stored.fileSize, 0);
  assert.equal(stored.e2ee.v, 2);
  assert.equal(stored.e2ee.blobId, blobId);
});

test('v2 upload rejects a blob the caller does not own', async () => {
  const ds = makeDocSpace([]);
  const { ctrl } = loadWith({ docSpace: ds }, null);
  const r = res();
  await ctrl.uploadDocument(uploadReq(), r);
  assert.equal(r.statusCode, 404);
  assert.equal(r.body.code, 'BLOB_NOT_FOUND');
  assert.equal(ds.lastAdded, undefined);
});

test('v2 upload rejects key entries for non-grantees', async () => {
  const ds = makeDocSpace([]);
  const { ctrl } = loadWith({ docSpace: ds });
  const r = res();
  await ctrl.uploadDocument(
    uploadReq({ e2ee: { v: 2, blobId, keyEnvelope: envelope([owner, stranger]) } }),
    r,
  );
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.code, 'INVALID_KEYS');
});

test('v2 upload rejects duplicate documentId', async () => {
  const ds = makeDocSpace([v2Doc()]);
  const { ctrl } = loadWith({ docSpace: ds });
  const r = res();
  await ctrl.uploadDocument(uploadReq(), r);
  assert.equal(r.statusCode, 409);
});

test('key PUT: stranger gets no write access (doc not in their space)', async () => {
  const { ctrl } = loadWith({ docSpace: null });
  const r = res();
  await ctrl.updateDocumentKey(
    { user: { userId: stranger }, params: { documentId: docId }, body: {} },
    r,
  );
  assert.equal(r.statusCode, 404);
});

test('key PUT: re-seal keeps keyVersion, rotation requires +1 and new blob', async () => {
  const doc = v2Doc(); // keyVersion 2
  const ds = makeDocSpace([doc]);
  const { ctrl } = loadWith({ docSpace: ds });

  // same version, no blobId → OK
  let r = res();
  await ctrl.updateDocumentKey({
    user: { userId: owner }, params: { documentId: docId },
    body: { keyEnvelope: envelope([owner, grantee]), keyVersion: 2 },
  }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(doc.e2ee.blobId, blobId);

  // same version WITH blobId → rejected
  r = res();
  await ctrl.updateDocumentKey({
    user: { userId: owner }, params: { documentId: docId },
    body: { keyEnvelope: envelope([owner, grantee]), keyVersion: 2, blobId },
  }, r);
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.code, 'UNEXPECTED_BLOB');

  // version jump >+1 → rejected
  r = res();
  await ctrl.updateDocumentKey({
    user: { userId: owner }, params: { documentId: docId },
    body: { keyEnvelope: envelope([owner, grantee]), keyVersion: 4, blobId },
  }, r);
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.code, 'INVALID_KEY_VERSION');

  // +1 without blobId → rejected
  r = res();
  await ctrl.updateDocumentKey({
    user: { userId: owner }, params: { documentId: docId },
    body: { keyEnvelope: envelope([owner, grantee]), keyVersion: 3 },
  }, r);
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.code, 'INVALID_BLOB');
});

test('key PUT rotation swaps blobId to an owned blob', async () => {
  const doc = v2Doc();
  const newBlob = 'c'.repeat(32);
  const ds = makeDocSpace([doc]);
  const { ctrl } = loadWith({ docSpace: ds });
  const r = res();
  await ctrl.updateDocumentKey({
    user: { userId: owner }, params: { documentId: docId },
    body: { keyEnvelope: envelope([owner, grantee]), keyVersion: 3, blobId: newBlob },
  }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(doc.e2ee.keyVersion, 3);
  assert.equal(doc.e2ee.blobId, newBlob);
});

test('e2ee GET: grantee allowed, stranger denied, owner allowed', async () => {
  const ds = makeDocSpace([v2Doc()]);
  const { ctrl } = loadWith({
    docSpace: ds,
    accessFor: (uid) => ({ hasAccess: uid === grantee }),
  });

  let r = res();
  await ctrl.getDocumentE2ee(
    { user: { userId: grantee }, params: { ownerId: owner, documentId: docId } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.data.blobId, blobId);

  r = res();
  await ctrl.getDocumentE2ee(
    { user: { userId: stranger }, params: { ownerId: owner, documentId: docId } }, r);
  assert.equal(r.statusCode, 403);

  r = res();
  await ctrl.getDocumentE2ee(
    { user: { userId: owner }, params: { ownerId: owner, documentId: docId } }, r);
  assert.equal(r.statusCode, 200);
});

test('e2ee GET: revoked grantee denied (hasAccess would have allowed)', async () => {
  const ds = makeDocSpace([v2Doc()]);
  ds.generalAccessList = []; // no general access
  ds.documentSpecificAccess = [{ documentId: docId, userId: grantee, isRevoked: true }];
  const { ctrl } = loadWith({ docSpace: ds });
  const r = res();
  await ctrl.getDocumentE2ee(
    { user: { userId: grantee }, params: { ownerId: owner, documentId: docId } }, r);
  assert.equal(r.statusCode, 403);
});

test('blob stream: stranger denied before sendFile, grantee streams', async () => {
  const ds = makeDocSpace([v2Doc()]);
  const { ctrl } = loadWith({
    docSpace: ds,
    accessFor: (uid) => ({ hasAccess: uid === grantee }),
  });

  let r = res();
  await ctrl.streamDocumentBlob(
    { user: { userId: stranger }, params: { ownerId: owner, documentId: docId } }, r);
  assert.equal(r.statusCode, 403);
  assert.equal(r.sentFile, undefined);

  r = res();
  await ctrl.streamDocumentBlob(
    { user: { userId: grantee }, params: { ownerId: owner, documentId: docId } }, r);
  assert.equal(r.sentFile?.file, blobId);
});

test('migrate: valid request encrypts record and deletes plaintext last', async () => {
  const plain = Buffer.from('legacy-pdf-bytes');
  const sha = crypto.createHash('sha256').update(plain).digest('hex');
  const legacy = {
    documentId: docId,
    documentType: 'Other',
    customName: 'My doc',
    fileUrl: '/uploads/documents/doc-1.pdf',
    fileType: 'application/pdf',
    fileSize: plain.length,
    markModified: () => {},
  };
  const ds = makeDocSpace([legacy]);
  const { ctrl, calls } = loadWith(
    { docSpace: ds },
    { blobId },
    { readFile: async () => plain },
  );
  const r = res();
  await ctrl.migrateDocument({
    user: { userId: owner }, params: { documentId: docId },
    body: { blobId, keyEnvelope: envelope([owner, grantee]), plaintextSha256: sha },
  }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(legacy.e2ee.v, 2);
  assert.equal(legacy.fileUrl, null);
  assert.equal(legacy.customName, '');
  assert.equal(calls.unlinked.length, 1);
  assert.match(calls.unlinked[0], /documents[/\\]doc-1\.pdf$/);
});

test('migrate: hash mismatch aborts — record untouched, file kept', async () => {
  const legacy = {
    documentId: docId,
    documentType: 'Other',
    customName: 'My doc',
    fileUrl: '/uploads/documents/doc-1.pdf',
    fileType: 'application/pdf',
    fileSize: 10,
    markModified: () => {},
  };
  const ds = makeDocSpace([legacy]);
  const { ctrl, calls } = loadWith(
    { docSpace: ds },
    { blobId },
    { readFile: async () => Buffer.from('real-plaintext') },
  );
  const r = res();
  await ctrl.migrateDocument({
    user: { userId: owner }, params: { documentId: docId },
    body: {
      blobId,
      keyEnvelope: envelope([owner, grantee]),
      plaintextSha256: crypto.createHash('sha256').update(Buffer.from('other')).digest('hex'),
    },
  }, r);
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.code, 'HASH_MISMATCH');
  assert.equal(legacy.e2ee, undefined);
  assert.equal(legacy.fileUrl, '/uploads/documents/doc-1.pdf');
  assert.equal(calls.unlinked.length, 0);
});

test('migrate: already-encrypted doc rejected', async () => {
  const ds = makeDocSpace([v2Doc()]);
  const { ctrl } = loadWith({ docSpace: ds });
  const r = res();
  await ctrl.migrateDocument({
    user: { userId: owner }, params: { documentId: docId },
    body: { blobId, keyEnvelope: envelope([owner, grantee]), plaintextSha256: 'a'.repeat(64) },
  }, r);
  assert.equal(r.statusCode, 409);
});
