/**
 * Shared media sanitizer — used by createRipple (the Ripple's own opening
 * media) and createEvent (reply media).
 *
 * Only absolute http(s) URLs are accepted: the client uploads through
 * /upload/post-media first and posts the resulting URLs, so anything else is a
 * malformed client and would otherwise be stored as a broken image.
 * `mimeType` is carried through for RippleEvent media (the reply composer
 * sends it); when `type` is missing it is derived from the mimeType prefix.
 */
const MEDIA_TYPES = ['image', 'video'];

const sanitizeMedia = (input, max = 10) => {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, max)
    .map((m) => ({
      type: MEDIA_TYPES.includes(m?.type)
        ? m.type
        : typeof m?.mimeType === 'string' && m.mimeType.startsWith('video/')
          ? 'video'
          : 'image',
      url: typeof m?.url === 'string' ? m.url.trim() : '',
      thumbnailUrl: typeof m?.thumbnailUrl === 'string' ? m.thumbnailUrl : null,
      mimeType: typeof m?.mimeType === 'string' ? m.mimeType : null,
      width: Number.isFinite(Number(m?.width)) ? Number(m.width) : null,
      height: Number.isFinite(Number(m?.height)) ? Number(m.height) : null,
      duration: Number.isFinite(Number(m?.duration)) ? Number(m.duration) : null,
    }))
    .filter((m) => /^https?:\/\//i.test(m.url));
};

module.exports = { sanitizeMedia };
