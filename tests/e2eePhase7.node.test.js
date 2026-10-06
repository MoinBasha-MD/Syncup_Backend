const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const express = require('express');
const { Readable } = require('node:stream');

const loadModule = (modulePath, mocks) => {
  const resolved = require.resolve(modulePath);
  const originalLoad = Module._load;
  const cached = require.cache[resolved];
  delete require.cache[resolved];
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(resolved);
  } finally {
    Module._load = originalLoad;
    if (cached) require.cache[resolved] = cached;
    else delete require.cache[resolved];
  }
};

const get = (app, path, userId) => new Promise((resolve) => {
  const server = app.listen(0, async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        headers: { 'x-test-user': userId || '' },
      });
      const body = await res.text();
      server.close();
      resolve({ status: res.status, body });
    } catch (e) {
      server.close();
      resolve({ status: 0, body: String(e) });
    }
  });
});

const owner = 'user-owner';
const grantee = 'user-grantee';
const revoked = 'user-revoked';
const stranger = 'user-stranger';

const DOC_ID = 'doc-1';
const FILENAME = 'a1b2c3d4e5f6.pdf';

const makeDocSpace = () => ({
  userId: owner,
  documents: [{
    documentId: DOC_ID,
    fileUrl: `/uploads/documents/${FILENAME}`,
    fileType: 'application/pdf',
    fileSize: 4,
  }],
  generalAccessList: [{ userId: grantee }],
  documentSpecificAccess: [{ documentId: DOC_ID, userId: revoked, isRevoked: true }],
  logAccess: async () => {},
});

const makeRouter = (docSpace) => loadModule('../routes/docSpaceDownloadRoutes', {
  '../middleware/authMiddleware': {
    protect: (req, _res, next) => {
      req.user = { userId: req.headers['x-test-user'], name: 'T' };
      next();
    },
  },
  '../models/DocSpace': {
    findOne: async (q) => (docSpace ? docSpace : null),
  },
  fs: {
    existsSync: () => true,
    statSync: () => ({ size: 4 }),
    createReadStream: () => Readable.from([Buffer.from('pdf!')]),
  },
});

const appFor = (docSpace) => {
  const app = express();
  app.use('/dl', makeRouter(docSpace));
  return app;
};

test('legacy download: owner and grantee stream; revoked/stranger/unknown → 404', async () => {
  const app = appFor(makeDocSpace());

  let r = await get(app, `/dl/${FILENAME}`, owner);
  assert.equal(r.status, 200);
  assert.equal(r.body, 'pdf!');

  r = await get(app, `/dl/view/${FILENAME}`, grantee);
  assert.equal(r.status, 200);

  r = await get(app, `/dl/view/${FILENAME}`, revoked);
  assert.equal(r.status, 404);

  r = await get(app, `/dl/view/${FILENAME}`, stranger);
  assert.equal(r.status, 404);

  r = await get(app, `/dl/${FILENAME}`, stranger);
  assert.equal(r.status, 404);

  r = await get(app, `/dl/view/unknown-file.pdf`, owner);
  assert.equal(r.status, 404);
});

test('legacy download: e2ee doc never streams even to the owner', async () => {
  const ds = makeDocSpace();
  ds.documents[0].e2ee = { v: 2, blobId: 'b'.repeat(32) };
  ds.documents[0].fileUrl = null; // v2 stores no fileUrl — nothing matches
  const app = appFor(ds);
  const r = await get(app, `/dl/view/${FILENAME}`, owner);
  assert.equal(r.status, 404);
});

// ---------------------------------------------------------------------------
// Backup routes
// ---------------------------------------------------------------------------

const backupRecords = new Map();
const blobRows = new Map();
const deletedBlobs = [];

const BLOB = 'f'.repeat(32);
const BLOB2 = 'e'.repeat(32);

const makeE2eeController = () => {
  const E2EEBackupMock = {
    // mongoose Query shape: thenable AND .lean() (putBackup awaits it
    // directly, getBackup awaits .lean()).
    findOne: (q) => {
      const rec = backupRecords.get(q.userId) ?? null;
      return {
        then: (resolve, reject) => Promise.resolve(rec).then(resolve, reject),
        lean: () => Promise.resolve(rec),
      };
    },
    findOneAndUpdate: async (q, data) => {
      backupRecords.set(q.userId, { ...data });
      return data;
    },
  };
  const BlobMock = {
    findOne: async (q) => {
      const row = blobRows.get(q.blobId);
      // emulate the ownership predicate in the real query
      return row && (!q.ownerUserId || row.ownerUserId === q.ownerUserId) ? row : null;
    },
    deleteOne: async (q) => { blobRows.delete(q.blobId); deletedBlobs.push(q.blobId); },
  };
  return loadModule('../controllers/e2eeController', {
    '../models/E2EEBackup': E2EEBackupMock,
    '../models/Blob': BlobMock,
    '../models/E2EEDevice': {},
    '../models/blockModel': {},
    fs: { unlinkSync: () => undefined },
  });
};

const res = () => ({
  statusCode: 200,
  body: undefined,
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});

test('backup PUT validates blob ownership + stores; GET returns own record', async () => {
  backupRecords.clear(); blobRows.clear(); deletedBlobs.length = 0;
  blobRows.set(BLOB, { blobId: BLOB, ownerUserId: owner });
  const ctrl = makeE2eeController();

  // Not my blob → 404
  blobRows.set(BLOB2, { blobId: BLOB2, ownerUserId: stranger });
  let r = res();
  await ctrl.putBackup({
    user: { userId: owner },
    body: { blobId: BLOB2, noncePrefix: 'AA==', encSize: 10, encSha256: 'BB==', createdAt: new Date().toISOString() },
  }, r);
  assert.equal(r.statusCode, 404);

  // My blob → stored
  r = res();
  await ctrl.putBackup({
    user: { userId: owner },
    body: { blobId: BLOB, noncePrefix: 'AA==', encSize: 10, encSha256: 'BB==', createdAt: new Date().toISOString() },
  }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(backupRecords.get(owner).blobId, BLOB);

  // Replace → old blob deleted
  blobRows.set(BLOB2, { blobId: BLOB2, ownerUserId: owner });
  r = res();
  await ctrl.putBackup({
    user: { userId: owner },
    body: { blobId: BLOB2, noncePrefix: 'CC==', encSize: 12, encSha256: 'DD==', createdAt: new Date().toISOString() },
  }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(backupRecords.get(owner).blobId, BLOB2);
  assert.ok(deletedBlobs.includes(BLOB));

  // GET own record
  r = res();
  await ctrl.getBackup({ user: { userId: owner } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.data.blobId, BLOB2);

  // GET for a stranger → 404
  r = res();
  await ctrl.getBackup({ user: { userId: stranger } }, r);
  assert.equal(r.statusCode, 404);
});

test('backup PUT rejects malformed metadata', async () => {
  const ctrl = makeE2eeController();
  const r = res();
  await ctrl.putBackup({
    user: { userId: 'u-rl' },
    body: { blobId: 'not-hex!', noncePrefix: 'AA==', encSize: 1, encSha256: 'BB==', createdAt: new Date().toISOString() },
  }, r);
  assert.equal(r.statusCode, 400);
});
