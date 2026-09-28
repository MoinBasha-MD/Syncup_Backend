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
const geocode = args.includes('--geocode');
const help = args.includes('--help');

const getLimit = () => {
  const inline = args.find((value) => value.startsWith('--limit='));
  const index = args.indexOf('--limit');
  const raw = inline ? inline.slice('--limit='.length) : index >= 0 ? args[index + 1] : null;
  return raw != null && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
};

const coordinatePair = (latValue, lngValue) => {
  if (latValue == null || lngValue == null || String(latValue).trim() === '' || String(lngValue).trim() === '') return null;
  const lat = Number(latValue);
  const lng = Number(lngValue);
  return Number.isFinite(lng) && Math.abs(lng) <= 180 && Number.isFinite(lat) && Math.abs(lat) <= 90
    ? { lng, lat }
    : null;
};

const getCoordinates = (location) => coordinatePair(location?.coordinates?.lat, location?.coordinates?.lng);

const HYDERABAD_LOCATION = {
  coordinates: { lng: 78.4750826, lat: 17.383912 },
  place: {
    label: 'Hyderabad, Telangana, India (default pin)',
    neighborhood: '',
    city: 'Hyderabad',
    state: 'Telangana',
    country: 'India',
    countryCode: 'IN',
    cityKey: 'in:hyderabad',
  },
  timezone: 'Asia/Kolkata',
};

const getCoordinatesFromName = (name) => {
  const parts = String(name || '').trim().split(',');
  if (parts.length !== 2) return null;
  const values = parts.map((part) => {
    const colon = part.indexOf(':');
    return (colon >= 0 ? part.slice(colon + 1) : part).trim();
  });
  return coordinatePair(values[0], values[1]);
};

const resolveCoordinates = async (location, mapboxService, cache) => {
  const stored = getCoordinates(location);
  if (stored) return { coordinates: stored, geocoded: false, defaulted: false, attempted: false };
  const name = location?._nameEncrypted ? '' : String(location?.name || '').trim();
  const parsed = getCoordinatesFromName(name);
  if (parsed) return { coordinates: parsed, geocoded: false, defaulted: false, attempted: false };
  if (!name) {
    return { coordinates: HYDERABAD_LOCATION.coordinates, geocoded: false, defaulted: true, attempted: false };
  }
  if (!mapboxService) return { coordinates: null, geocoded: false, defaulted: false, attempted: false };

  const key = name.toLowerCase();
  if (!cache.has(key)) {
    const places = await mapboxService.forwardGeocode(name, 1);
    const first = places[0]?.coordinates;
    cache.set(key, first ? coordinatePair(first.latitude, first.longitude) : null);
  }
  const coordinates = cache.get(key);
  return { coordinates, geocoded: !!coordinates, defaulted: false, attempted: true };
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
    console.log('Dry run: node backfillFeedPostsAsShorts.js --geocode');
    console.log('Apply:    node backfillFeedPostsAsShorts.js --apply --limit 100 --geocode');
    console.log('--geocode resolves saved addresses with Mapbox; the first match is used.');
    console.log('Posts with no usable location default to Hyderabad city center and are labeled as default pins.');
    console.log('A positive --limit is required with --apply. Re-running is safe and continues past converted posts.');
    return;
  }

  const limit = getLimit();
  if (apply && !limit) throw new Error('--apply requires a positive --limit to cap database writes');
  if (geocode && !process.env.MAPBOX_PUBLIC_TOKEN) throw new Error('MAPBOX_PUBLIC_TOKEN is required with --geocode');
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  const mapboxService = geocode ? require('./services/mapboxService') : null;

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });

  const stats = {
    scanned: 0,
    eligible: 0,
    created: 0,
    alreadyConverted: 0,
    geocoded: 0,
    defaultedHyderabad: 0,
    skipped: {
      noCoordinates: 0,
      geocodeFailed: 0,
      noMedia: 0,
      encryptedContent: 0,
      invalidMedia: 0,
      missingOwner: 0,
    },
  };
  const geocodeCache = new Map();
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

    if (post._captionEncrypted || post.media?.some((item) => item?.encrypted)) {
      stats.skipped.encryptedContent += 1;
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
    const resolved = await resolveCoordinates(post.location, mapboxService, geocodeCache);
    const coordinates = resolved.coordinates;
    if (!coordinates) {
      stats.skipped[resolved.attempted ? 'geocodeFailed' : 'noCoordinates'] += 1;
      continue;
    }
    if (resolved.geocoded) stats.geocoded += 1;
    if (resolved.defaulted) stats.defaultedHyderabad += 1;

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
      timezone: resolved.defaulted ? HYDERABAD_LOCATION.timezone : null,
      location: { type: 'Point', coordinates: [coordinates.lng, coordinates.lat] },
      place: resolved.defaulted ? { ...HYDERABAD_LOCATION.place } : {
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
