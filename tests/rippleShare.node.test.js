/**
 * Phase 3 — share-landing pure helpers. No Mongo, no HTTP: escapeHtml and
 * the isShareable/shareImage predicates are pure functions on plain objects.
 */
const test = require('node:test');
const assert = require('node:assert');

const { _internal } = require('../routes/rippleShareRoutes');
const { escapeHtml, isShareable, shareImage, absoluteUrl } = _internal;

test('escapeHtml neutralises markup and quotes', () => {
  assert.strictEqual(
    escapeHtml(`<script>alert("x")</script> & 'quotes'`),
    `&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;`,
  );
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml(42), '42');
  assert.strictEqual(escapeHtml('plain title'), 'plain title');
});

const shareable = (over = {}) => ({
  visibility: 'public',
  lifecycle: 'active',
  moderation: { reviewStatus: 'approved' },
  ...over,
});

test('isShareable gates on public + live-ish + unflagged', () => {
  assert.strictEqual(isShareable(null), false);
  assert.strictEqual(isShareable(shareable()), true);
  assert.strictEqual(isShareable(shareable({ lifecycle: 'scheduled' })), true);
  assert.strictEqual(isShareable(shareable({ lifecycle: 'wrapping' })), true);
  assert.strictEqual(isShareable(shareable({ lifecycle: 'memory' })), true);
  assert.strictEqual(isShareable(shareable({ lifecycle: 'cancelled' })), true);
  assert.strictEqual(isShareable(shareable({ lifecycle: 'draft' })), false);
  assert.strictEqual(isShareable(shareable({ lifecycle: 'removed' })), false);
  assert.strictEqual(isShareable(shareable({ visibility: 'friends' })), false);
  assert.strictEqual(isShareable(shareable({ visibility: 'invite' })), false);
  assert.strictEqual(
    isShareable(shareable({ moderation: { reviewStatus: 'under_review' } })),
    false,
  );
  assert.strictEqual(isShareable(shareable({ moderation: undefined })), true);
});

test('shareImage prefers the first image, falls back to a video thumbnail', () => {
  assert.strictEqual(
    shareImage({ media: [{ type: 'image', url: '/uploads/a.jpg' }] }),
    '/uploads/a.jpg',
  );
  assert.strictEqual(
    shareImage({
      media: [
        { type: 'video', url: '/uploads/v.mp4', thumbnailUrl: '/uploads/t.jpg' },
      ],
    }),
    '/uploads/t.jpg',
  );
  assert.strictEqual(
    shareImage({ media: [{ type: 'video', url: '/uploads/v.mp4' }] }),
    null,
  );
  assert.strictEqual(shareImage({ media: [] }), null);
  assert.strictEqual(shareImage({}), null);
});

test('absoluteUrl resolves relative paths against the request host', () => {
  const req = { protocol: 'https', get: () => 'api.crackman.in' };
  assert.strictEqual(
    absoluteUrl(req, '/uploads/x.jpg'),
    'https://api.crackman.in/uploads/x.jpg',
  );
  assert.strictEqual(
    absoluteUrl(req, 'https://cdn.example.com/x.jpg'),
    'https://cdn.example.com/x.jpg',
  );
  assert.strictEqual(absoluteUrl(req, null), null);
});
