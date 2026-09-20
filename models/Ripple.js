const mongoose = require('mongoose');

/**
 * Media attached to a Ripple itself (the host's opening post). Mirrors
 * RippleEvent's media subdocument so the client renders both with one
 * component and neither grows a per-item `_id` nobody reads.
 */
const mediaSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['image', 'video'], default: 'image' },
    url: { type: String, required: true },
    thumbnailUrl: { type: String, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration: { type: Number, default: null },
  },
  { _id: false },
);

/**
 * Ripple — a place-anchored container for a shared intention (Open Network).
 *
 * Dual location storage is deliberate:
 *   - `location` (2dsphere) serves $near for the "nearby" endpoint.
 *   - flat indexed `lng`/`lat` serve viewport bbox queries and the cluster
 *     aggregation as plain numeric range queries — $geoWithin $box needs a 2d
 *     index and world-spanning polygons at globe zoom are error-prone, so the
 *     bbox path intentionally does NOT go through 2dsphere.
 * A pre('save') hook keeps the two in sync.
 */
const rippleSchema = new mongoose.Schema(
  {
    hostUserId: {
      type: String, // req.user.userId — String key, matching Friend/Block/GroupChat
      required: true,
      index: true,
    },
    hostPageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Page',
      default: null,
    },
    hostName: {
      type: String, // denormalized for cards
      default: '',
    },
    hostIsPage: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String,
      required: true,
      maxlength: 120,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    type: {
      type: String,
      enum: ['activity', 'question', 'request', 'plan', 'event', 'interest', 'alert', 'project'],
      required: true,
    },
    reach: {
      type: String,
      enum: ['neighborhood', 'city', 'region', 'global', 'online'],
      default: 'city',
    },
    reachKm: {
      type: Number, // derived from reach by services/openNetworkGeo.reachToKm
      default: null,
    },
    visibility: {
      type: String,
      enum: ['public', 'friends', 'invite'],
      default: 'public',
    },
    discoverability: {
      type: String,
      enum: ['listed', 'unlisted'],
      default: 'listed',
    },
    joinPolicy: {
      type: String,
      enum: ['open', 'approval', 'invite'],
      default: 'approval',
    },
    lifecycle: {
      type: String,
      enum: ['draft', 'scheduled', 'active', 'wrapping', 'memory', 'cancelled', 'removed'],
      default: 'draft',
    },
    // Undefined entirely for reach 'online' — an online Ripple has no place.
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [lng, lat]
        default: undefined,
      },
    },
    lng: { type: Number, default: null },
    lat: { type: Number, default: null },
    place: {
      label: { type: String, default: '' },
      neighborhood: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      country: { type: String, default: '' },
      countryCode: { type: String, default: '' },
      cityKey: { type: String, default: '' }, // `${countryCode}:${slug(city)}` lowercased
    },
    /**
     * Photos/videos attached to the Ripple itself (the host's opening post).
     * Same shape as a RippleEvent's media so the detail screen renders both
     * with one component.
     */
    media: {
      type: [mediaSchema],
      default: [],
    },
    /** Background track, mirroring FeedPost.music so the player is reusable. */
    music: {
      trackId: { type: String, default: null },
      title: { type: String, default: null },
      artist: { type: String, default: null },
      filename: { type: String, default: null },
      startTime: { type: Number, default: 0 },
      endTime: { type: Number, default: 30 },
      volume: { type: Number, default: 0.7, min: 0, max: 1 },
      mixMode: { type: String, enum: ['mix', 'replace', 'mute_original'], default: 'mix' },
      loop: { type: Boolean, default: true },
    },
    timezone: {
      type: String,
      default: null,
    },
    startAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    wrapUntil: { type: Date, default: null },
    capacity: { type: Number, default: null },
    counts: {
      ripplers: { type: Number, default: 0 },
      followers: { type: Number, default: 0 },
      events: { type: Number, default: 0 },
      pendingRequests: { type: Number, default: 0 },
    },
    settings: {
      ripplersCanPostEvents: { type: Boolean, default: true },
      verifiedOnly: { type: Boolean, default: false },
    },
    groupChatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GroupChat',
      default: null,
    },
    rating: {
      sum: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
      average: { type: Number, default: null },
    },
    idempotencyKey: {
      type: String,
      // No `default: null` on purpose. A unique+sparse index only skips docs
      // where the field is ABSENT; a stored null counts as a value, so every
      // Ripple created without an Idempotency-Key header would collide on the
      // second insert. Left undefined the field isn't persisted at all.
      default: undefined,
    },
    moderation: {
      reportCount: { type: Number, default: 0 },
      removedAt: { type: Date, default: null },
      removedReason: { type: String, default: null },
    },
  },
  { timestamps: true },
);

// Keep the flat bbox fields in lockstep with the GeoJSON point — every write
// path (save()) funnels through here.
rippleSchema.pre('save', function (next) {
  const coords = this.location && this.location.coordinates;
  if (Array.isArray(coords) && coords.length === 2) {
    this.lng = coords[0];
    this.lat = coords[1];
  } else {
    this.lng = null;
    this.lat = null;
    // Critical for `reach: 'online'`: location.type defaults to 'Point', which
    // would otherwise materialize a `{type:'Point'}` subdoc with no coords.
    // The 2dsphere index then rejects it ("Point must be an array or object").
    // An online Ripple must store NO location subdocument at all.
    this.location = undefined;
  }
  next();
});

rippleSchema.index({ location: '2dsphere' });
rippleSchema.index({ lng: 1, lat: 1 });
rippleSchema.index({ lifecycle: 1, discoverability: 1, visibility: 1 });
rippleSchema.index({ hostUserId: 1, createdAt: -1 });
rippleSchema.index({ 'place.countryCode': 1, lifecycle: 1 });
rippleSchema.index({ 'place.cityKey': 1, lifecycle: 1 });
// Partial (not sparse) so uniqueness is enforced only for real string keys —
// see the note on the field above.
rippleSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
rippleSchema.index({ title: 'text', description: 'text' });

const Ripple = mongoose.model('Ripple', rippleSchema);

module.exports = Ripple;
