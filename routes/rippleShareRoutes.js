/**
 * Public Ripple share landing — GET /r/:id
 *
 * A self-contained HTML page (inline CSS, no external JS) so a shared link
 * unfurls with og: tags and shows a card for people who don't have the app.
 * Privacy rule: anything that isn't a public, live-ish, unflagged Ripple
 * renders the SAME generic "private or unavailable" page — no title, no
 * place, no hint about which gate failed. Invalid ids → same page, 200.
 *
 * Mounted at the app root (server.js, `app.use('/r', apiLimiter, ...)`) —
 * NO auth: the whole point is that a link works for someone without a
 * Syncup account.
 */
const express = require('express');
const mongoose = require('mongoose');
const Ripple = require('../models/Ripple');

const router = express.Router();

/** Escape every interpolated value — the page is only as safe as this. */
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

/**
 * May this Ripple be shown on a public landing page?
 * Deliberately excludes drafts (never published), removed, and anything
 * under moderation review; cancelled/memory still unfurl — a share link for
 * a past Ripple is a legitimate thing to open.
 */
const isShareable = (ripple) =>
  !!ripple &&
  ripple.visibility === 'public' &&
  !['removed', 'draft'].includes(ripple.lifecycle) &&
  ripple.moderation?.reviewStatus !== 'under_review';

/** First image media url, else first video thumbnail — the og:image. */
const shareImage = (ripple) => {
  const media = Array.isArray(ripple?.media) ? ripple.media : [];
  const image = media.find((m) => m?.type === 'image' && m.url);
  if (image) return image.url;
  const video = media.find((m) => m?.type === 'video' && m.thumbnailUrl);
  return video?.thumbnailUrl || null;
};

/** Turn a stored /uploads path absolute against the request host. */
const absoluteUrl = (req, url) => {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = `${req.protocol}://${req.get('host') || ''}`;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
};

const PAGE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #FAFAFF; color: #17142B; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .card {
    max-width: 420px; width: 100%; background: #FFFFFF;
    border: 1px solid #EDE9FE; border-radius: 24px; overflow: hidden;
    box-shadow: 0 12px 40px rgba(109, 40, 217, 0.10);
  }
  .cover { width: 100%; aspect-ratio: 16/10; object-fit: cover; display: block; background: #EDE9FE; }
  .body { padding: 24px; }
  .eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #8B5CF6; margin-bottom: 8px; }
  h1 { font-size: 22px; line-height: 1.25; margin-bottom: 6px; }
  .place { font-size: 14px; color: #6B6685; margin-bottom: 20px; }
  .cta {
    display: block; text-align: center; text-decoration: none;
    background: linear-gradient(135deg, #8B5CF6, #6D28D9); color: #FFFFFF;
    font-weight: 600; font-size: 16px; padding: 14px 20px; border-radius: 999px;
  }
  .sub { font-size: 12px; color: #9B96B8; text-align: center; margin-top: 14px; }
`;

const genericPage = (id) => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ripple — Syncup Open Network</title>
<meta property="og:title" content="Ripple on Syncup Open Network">
<meta property="og:description" content="Shared intentions, anchored to places.">
<style>${PAGE_CSS}</style>
</head><body>
<div class="card"><div class="body">
<p class="eyebrow">Syncup Open Network</p>
<h1>This Ripple is private or no longer available</h1>
<p class="place">If you have the app installed, try opening it there.</p>
<a class="cta" href="syncup://ripple/${escapeHtml(id)}">Open in Syncup</a>
<p class="sub">Open Network — shared intentions, anchored to places</p>
</div></div>
</body></html>`;

const ripplePage = (req, ripple) => {
  const id = String(ripple._id);
  const title = ripple.title || 'Ripple';
  const place = ripple.place?.label || 'Open Network';
  const description = `${place} · on Syncup Open Network`;
  const image = absoluteUrl(req, shareImage(ripple));
  const host = ripple.hostName ? `Hosted by ${ripple.hostName}` : null;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Syncup Open Network</title>
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
<meta property="og:type" content="website">
<style>${PAGE_CSS}</style>
</head><body>
<div class="card">
${image ? `<img class="cover" src="${escapeHtml(image)}" alt="">` : ''}
<div class="body">
<p class="eyebrow">Syncup Open Network</p>
<h1>${escapeHtml(title)}</h1>
<p class="place">${escapeHtml(description)}</p>
${host ? `<p class="place">${escapeHtml(host)}</p>` : ''}
<a class="cta" href="syncup://ripple/${escapeHtml(id)}">Open in Syncup</a>
<p class="sub">Open Network — shared intentions, anchored to places</p>
</div></div>
</body></html>`;
};

// @route GET /r/:id — no auth; a share link must unfurl for anyone.
router.get('/:id', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(200).type('html').send(genericPage(req.params.id));
    }
    const ripple = await Ripple.findById(req.params.id)
      .select('title place media visibility lifecycle moderation hostName')
      .lean();
    if (!isShareable(ripple)) {
      return res.status(200).type('html').send(genericPage(req.params.id));
    }
    return res.status(200).type('html').send(ripplePage(req, ripple));
  } catch (e) {
    // A landing page must never 500 for a crawler — fall back to generic.
    return res.status(200).type('html').send(genericPage(req.params.id));
  }
});

router._internal = { escapeHtml, isShareable, shareImage, absoluteUrl };

module.exports = router;
