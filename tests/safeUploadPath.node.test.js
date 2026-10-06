const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { resolveUploadPath } = require('../utils/safeUploadPath');
const encryptedFileRoutes = require('../routes/encryptedFileRoutes');

const UPLOADS = path.resolve(__dirname, '..', 'uploads');

test('resolveUploadPath rejects traversal and non-filename input', () => {
  for (const bad of ['../../.env', '..\\..\\.env', 'a/b.jpg', '..', '', 'file\0name.jpg', '.']) {
    assert.equal(resolveUploadPath('profile-images', bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
  assert.equal(resolveUploadPath('profile-images', 'x'.repeat(256)), null, 'expected null for >255 chars');
  assert.equal(resolveUploadPath('profile-images', undefined), null);
  assert.equal(resolveUploadPath('profile-images', 42), null);
});

test('resolveUploadPath accepts a normal filename inside the subdir', () => {
  const resolved = resolveUploadPath('profile-images', 'file-123-456.jpg');
  assert.equal(resolved, path.join(UPLOADS, 'profile-images', 'file-123-456.jpg'));
});

test('GET /api/uploads/profile-images/..%2F..%2F.env returns 404 before touching disk', async (t) => {
  const app = express();
  app.use('/api', encryptedFileRoutes);
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  t.after(() => server.close());
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/uploads/profile-images/..%2F..%2F.env`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.deepEqual(body, { success: false, message: 'File not found' });

  // Public route must still serve valid filenames (404 from missing file on disk, not from path rejection)
  const res2 = await fetch(`http://127.0.0.1:${port}/api/uploads/profile-images/definitely-not-a-real-file-zzz.jpg`);
  assert.equal(res2.status, 404);
});
