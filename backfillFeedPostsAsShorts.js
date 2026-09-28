require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const mongoose = require('mongoose');
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const FeedPost = require('./models/FeedPost');
const Ripple = require('./models/Ripple');
const Rippler = require('./models/Rippler');
const { reachToKm } = require('./services/openNetworkGeo');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const help = args.includes('--help');

const getLimit = () => {
  const inline = args.find((value) => value.startsWith('--limit='));
  const index = args.indexOf('--limit');
  const raw = inline ? inline.slice('--limit='.length) : index >= 0 ? args[index + 1] : null;
  return raw != null && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
};

const getCoordinates = (location) => {
  const lngValue = location?.coordinates?.lng;
  const latValue = location?.coordinates?.lat;
  if (lngValue == null || latValue == null || String(lngValue).trim() === '' || String(latValue).trim() === '') return null;
  const lng = Number(lngValue);
  const lat = Number(latValue);
  return Number.isFinite(lng) && Math.abs(lng) <= 180 && Number.isFinite(lat) && Math.abs(lat) <= 90
    ? { lng, lat }
    : null;
};

const finiteNumberOrNull = (value) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const mediaForRipple = (items) => (Array.isArray(items) ? items : [])
  .filter((item) => item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url.trim()))
  .slice(0, 10)
  .map((item) => ({
    type: item.type === 'video' ? 'video' : 'image',
    url: item.url.trim(),
    thumbnailUrl: item.thumbnail || null,
    width: finiteNumberOrNull(item.width),
    height: finiteNumberOrNull(item.height),
    duration: finiteNumberOrNull(item.duration),
  }));

const run = async () => {
  if (help) {
    console.log('Dry run: node backfillFeedPostsAsShorts.js');
    console.log('Apply:    node backfillFeedPostsAsShorts.js --apply --limit 100');
    console.log('A positive --limit is required with --apply. Re-running is safe and continues past converted posts.');
    return;
  }

  const limit = getLimit();
  if (apply && !limit) throw new Error('--apply requires a positive --limit to cap database writes');
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  const stats = {
    scanned: 0,
    eligible: 0,
    created: 0,
    alreadyConverted: 0,
    skipped: {
      noCoordinates: 0,
      noMedia: 0,
      encryptedContent: 0,
      invalidMedia: 0,
      missingOwner: 0,
    },
  };
  const query = {
    isActive: true,
    privacy: { $in: ['public', null] },
    isPagePost: { $ne: true },
    pageId: null,
    isRepost: { $ne: true },
  };

  for await (const post of FeedPost.find(query).select('+_captionEncrypted').sort({ _id: 1 }).cursor({ batchSize: 250 })) {
    stats.scanned += 1;
    const idempotencyKey = `feedpost:${post._id}`;
    const existing = await Ripple.findOne({ idempotencyKey }).select('_id hostUserId').lean();
    if (existing) {
      stats.alreadyConverted += 1;
      if (apply) {
        await Rippler.updateOne(
          { rippleId: existing._id, userId: existing.hostUserId },
          { $setOnInsert: { rippleId: existing._id, userId: existing.hostUserId, role: 'host', status: 'approved', joinedAt: new Date(), approvedBy: existing.hostUserId } },
          { upsert: true },
        );
      }
      continue;
    }

    if (post._captionEncrypted && typeof post.decrypt === 'function') post.decrypt();
    if (post._captionEncrypted || post.media?.some((item) => item?.encrypted)) {
      stats.skipped.encryptedContent += 1;
      continue;
    }
    const coordinates = getCoordinates(post.location);
    if (!coordinates) {
      stats.skipped.noCoordinates += 1;
      continue;
    }
    if (!Array.isArray(post.media) || post.media.length === 0) {
      stats.skipped.noMedia += 1;
      continue;
    }
    const media = mediaForRipple(post.media);
    if (!media.length) {
      stats.skipped.invalidMedia += 1;
      continue;
    }
    if (!post.userId) {
      stats.skipped.missingOwner += 1;
      continue;
    }

    if (apply && stats.created >= limit) break;
    stats.eligible += 1;
    if (!apply) continue;

    const caption = String(post.caption || '').trim();
    const title = caption.length >= 3 ? caption.slice(0, 120) : 'A moment';
    const ripple = await Ripple.create({
      hostUserId: post.userId,
      hostName: post.userName || '',
      title,
      type: 'activity',
      kind: 'short',
      media,
      music: post.music?.trackId ? post.music : undefined,
      reach: 'city',
      reachKm: reachToKm('city'),
      visibility: 'public',
      discoverability: 'listed',
      joinPolicy: 'open',
      lifecycle: 'active',
      location: { type: 'Point', coordinates: [coordinates.lng, coordinates.lat] },
      place: {
        label: post.location?._nameEncrypted ? '' : String(post.location?.name || '').trim(),
        neighborhood: '',
        city: '',
        state: '',
        country: '',
        countryCode: '',
        cityKey: '',
      },
      counts: { ripplers: 1, followers: 0, events: 0, pendingRequests: 0, supports: 0, interactors: 0 },
      idempotencyKey,
    });
    await Rippler.updateOne(
      { rippleId: ripple._id, userId: post.userId },
      { $setOnInsert: { rippleId: ripple._id, userId: post.userId, role: 'host', status: 'approved', joinedAt: new Date(), approvedBy: post.userId } },
      { upsert: true },
    );
    stats.created += 1;
  }

  console.log(apply ? 'Feed post to Short backfill complete' : 'Feed post to Short dry run complete', stats);
};

run()
  .catch((error) => {
    console.error('Feed post to Short backfill failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
