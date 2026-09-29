const mongoose = require('mongoose');

/**
 * What a member says they're up for — drives the people filters. Kept on the
 * model so a new value is one enum entry, not a migration across fields.
 */
const OPEN_TO = [
  'hangout',
  'coffee',
  'collab',
  'study',
  'sports',
  'music',
  'gaming',
  'travel',
  'language_exchange',
  'networking',
  'volunteering',
  'food',
];

/**
 * OpenNetworkProfile — a user's opt-in state, defaults and reputation for
 * the Open Network feature. Created lazily via getOrCreate.
 *
 * PRIVACY: `home.point` is a COARSE (~5 km grid) snapped point, never the
 * user's real coordinates — the same rule as Rippler.originCentroid.
 */
const openNetworkProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    joined: { type: Boolean, default: false },
    joinedAt: { type: Date, default: null },
    leftAt: { type: Date, default: null },
    settings: {
      discoverable: { type: Boolean, default: true },
      defaultReach: {
        type: String,
        enum: ['neighborhood', 'city', 'region', 'global', 'online'],
        default: 'city',
      },
      defaultVisibility: {
        type: String,
        enum: ['public', 'friends', 'invite'],
        default: 'public',
      },
      notifyNearby: { type: Boolean, default: true },
    },
    reputation: {
      hostSum: { type: Number, default: 0 },
      hostCount: { type: Number, default: 0 },
      hostScore: { type: Number, default: null },
      attendedCount: { type: Number, default: 0 },
      noShowCount: { type: Number, default: 0 },
    },
    limits: {
      ripplesCreatedToday: { type: Number, default: 0 },
      lastCreateAt: { type: Date, default: null },
    },
    /**
     * The people-layer persona — public to other joined members.
     * interests arrive trimmed/lowercased/deduped (≤10, ≤24 chars each),
     * enforced again in updatePersona so old writes stay consistent.
     */
    persona: {
      headline: { type: String, default: '', maxlength: 60 },
      bio: { type: String, default: '', maxlength: 280 },
      interests: { type: [String], default: [] },
      openTo: { type: [String], enum: OPEN_TO, default: [] },
    },
    /**
     * Coarse home anchor — city-level label + a snapped point (~5 km grid).
     * NEVER the user's precise location. `point.type` deliberately has no
     * default: a default 'Point' with empty coordinates materializes a
     * {type:'Point'} subdoc the 2dsphere index rejects (same pitfall as
     * Ripple.location — its pre-save hook drops the subdoc instead).
     */
    home: {
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      country: { type: String, default: '' },
      countryCode: { type: String, default: '' },
      cityKey: { type: String, default: '' }, // `${countryCode}:${slug(city)}` lowercased
      label: { type: String, default: '' },
      point: {
        type: {
          type: String,
          enum: ['Point'],
        },
        coordinates: {
          type: [Number], // [lng, lat] — already coarse
          default: undefined,
        },
      },
      // Flat duplicates for bbox queries — $geoWithin/$box is a legacy-
      // coordinate operator and does not reliably match GeoJSON (the same
      // reason Ripple stores flat lng/lat; see that model). Kept in sync by
      // the pre-save hook below — write `point` only, never these directly.
      lng: { type: Number, default: null },
      lat: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },
    lastActiveAt: { type: Date, default: null },
    /** Throttle for "new Ripple near you" pushes — at most one per 6h. */
    lastNearbyNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// A profile with no coords must store NO point subdoc — mirrors the
// Ripple.location pre-save (see that comment for the index failure mode) —
// and the flat lng/lat fields must stay in lockstep with it.
openNetworkProfileSchema.pre('save', function (next) {
  const coords = this.home?.point?.coordinates;
  if (Array.isArray(coords) && coords.length === 2 && coords.every(Number.isFinite)) {
    this.home.lng = coords[0];
    this.home.lat = coords[1];
  } else if (this.home) {
    this.home.point = undefined;
    this.home.lng = null;
    this.home.lat = null;
  }
  next();
});

openNetworkProfileSchema.statics.getOrCreate = async function (userId) {
  const existing = await this.findOne({ userId });
  if (existing) return existing;
  try {
    return await this.create({ userId });
  } catch (err) {
    // Two concurrent first requests can race the unique index — the loser
    // just reads the row the winner created.
    if (err && err.code === 11000) return this.findOne({ userId });
    throw err;
  }
};

// Geo lookup for the people layer + the joined/discoverable/city index for
// the heat aggregation.
openNetworkProfileSchema.index({ 'home.point': '2dsphere' }, { sparse: true });
openNetworkProfileSchema.index({ joined: 1, 'settings.discoverable': 1, 'home.cityKey': 1 });
// Flat-field bbox index for the heat aggregation — mirrors Ripple.lng/lat.
openNetworkProfileSchema.index({ 'home.lng': 1, 'home.lat': 1 });

const OpenNetworkProfile = mongoose.model('OpenNetworkProfile', openNetworkProfileSchema);
OpenNetworkProfile.OPEN_TO = OPEN_TO;

module.exports = OpenNetworkProfile;
