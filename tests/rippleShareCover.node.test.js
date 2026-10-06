const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const express = require('express');

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

const get = (app, path) => new Promise((resolve) => {
  const server = app.listen(0, async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        redirect: 'manual',
      });
      const body = await res.buffer ? await res.buffer() : Buffer.from(await res.arrayBuffer());
      server.close();
      resolve({
        status: res.status,
        body: body.toString('utf8'),
        bytes: body,
        headers: Object.fromEntries(res.headers.entries()),
      });
    } catch (e) {
      server.close();
      resolve({ status: 0, body: String(e), bytes: Buffer.alloc(0), headers: {} });
    }
  });
});

const RID = '507f1f77bcf86cd799439011';
const COVER_URL = `https://api.test/uploads/post-media/cover-${RID}.jpg`;
const COVER_BYTES = 'JPEG-BYTES';

const publicRipple = (over = {}) => ({
  _id: RID,
  title: 'Beach cleanup',
  place: { label: 'Lisbon' },
  media: [{ type: 'image', url: COVER_URL }],
  visibility: 'public',
  lifecycle: 'active',
  moderation: { reviewStatus: 'ok' },
  hostName: 'Ana',
  ...over,
});

const makeApp = (ripple, fsOverrides = {}) => {
  const RippleMock = {
    findById: () => ({ select: () => ({ lean: async () => ripple }) }),
  };
  const fsMock = {
    existsSync: () => true,
    promises: {
      access: fsOverrides.access ?? (async () => undefined),
      readFile: fsOverrides.readFile ?? (async () => Buffer.from(COVER_BYTES)),
    },
  };
  const router = loadModule('../routes/rippleShareRoutes', {
    '../models/Ripple': RippleMock,
    '../middleware/fileEncryptionMiddleware': loadModule(
      '../middleware/fileEncryptionMiddleware',
      {
        fs: fsMock,
        '../models/FeedPost': { findOne: async () => null },
        '../models/storyModel': { findOne: async () => null },
        '../models/userModel': { findOne: async () => null },
        '../models/groupModel': { findOne: async () => null },
        '../utils/fileEncryption': { getInstance: () => ({ decryptFile: async () => { throw new Error('nope'); } }) },
        '../utils/mediaFileEncryption': { getInstance: () => ({}) },
      },
    ),
  });
  const app = express();
  app.use('/r', router);
  return app;
};

test('public ripple cover streams the local post-media file', async () => {
  const app = makeApp(publicRipple());
  const r = await get(app, `/r/${RID}/cover`);
  assert.equal(r.status, 200);
  assert.equal(r.body, COVER_BYTES);
  assert.equal(r.headers['content-type'], 'image/jpeg');
  assert.match(r.headers['cache-control'] || '', /public, max-age=300/);
});

test('page HTML references /r/:id/cover for og:image + twitter', async () => {
  const app = makeApp(publicRipple());
  const r = await get(app, `/r/${RID}`);
  assert.equal(r.status, 200);
  assert.match(r.body, new RegExp(`og:image" content="[^"]*/r/${RID}/cover"`));
  assert.match(r.body, new RegExp(`twitter:image" content="[^"]*/r/${RID}/cover"`));
  assert.match(r.body, /twitter:card" content="summary_large_image"/);
  assert.match(r.body, new RegExp(`og:url" content="[^"]*/r/${RID}"`));
  assert.match(r.body, new RegExp(`<img class="cover" src="[^"]*/r/${RID}/cover"`));
});

test('private / draft / removed / under_review ripples → cover 404, page has no og:image', async () => {
  for (const over of [
    { visibility: 'friends' },
    { lifecycle: 'draft' },
    { lifecycle: 'removed' },
    { moderation: { reviewStatus: 'under_review' } },
  ]) {
    const app = makeApp(publicRipple(over));
    const cover = await get(app, `/r/${RID}/cover`);
    assert.equal(cover.status, 404, JSON.stringify(over));
    const page = await get(app, `/r/${RID}`);
    assert.doesNotMatch(page.body, /og:image/, JSON.stringify(over));
  }
});

test('invalid id → 404 on cover, generic page on /r/:id', async () => {
  const app = makeApp(publicRipple());
  const r = await get(app, '/r/not-an-id/cover');
  assert.equal(r.status, 404);
  const page = await get(app, '/r/not-an-id');
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.body, /og:image/);
});

test('traversal in the stored URL never reaches the filesystem', async () => {
  const app = makeApp(publicRipple({
    media: [{ type: 'image', url: 'https://api.test/uploads/post-media/..%2F..%2F.env' }],
  }));
  // the encoded '..%2F' lands inside the filename group
  let r = await get(app, `/r/${RID}/cover`);
  assert.equal(r.status, 404);

  const app2 = makeApp(publicRipple({
    media: [{ type: 'image', url: 'https://api.test/uploads/../env' }],
  }));
  r = await get(app2, `/r/${RID}/cover`);
  // '../env' doesn't match the /uploads/<subdir>/<file> shape at all → redirect? No: pathname is /uploads/../env → matches subdir='..'? subdir regex is [a-z0-9-]+ — '..' fails → 302 to the (non-ours-looking) URL... which is actually ours-looking; acceptable per spec either way.
  assert.ok([302, 404].includes(r.status));
});

test('third-party absolute cover URL → 302 redirect', async () => {
  const app = makeApp(publicRipple({
    media: [{ type: 'image', url: 'https://cdn.example.com/x.jpg' }],
  }));
  const r = await get(app, `/r/${RID}/cover`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, 'https://cdn.example.com/x.jpg');
});

test('MEDIA_AUTH_ENFORCE=true does not gate /r/:id/cover', async () => {
  process.env.MEDIA_AUTH_ENFORCE = 'true';
  try {
    const app = makeApp(publicRipple());
    const r = await get(app, `/r/${RID}/cover`);
    assert.equal(r.status, 200);
    assert.equal(r.body, COVER_BYTES);
  } finally {
    delete process.env.MEDIA_AUTH_ENFORCE;
  }
});

test('missing file on disk → 404', async () => {
  const app = makeApp(publicRipple(), {
    access: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  });
  const r = await get(app, `/r/${RID}/cover`);
  assert.equal(r.status, 404);
});
