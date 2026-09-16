/**
 * Open Network geo helpers — pure functions (plus resolvePlace, which wraps
 * mapboxService reverse geocoding). No DB access lives here.
 */
const mapboxService = require('./mapboxService');

// Human-meaningful reach -> search radius in km. global/online are unbounded.
const REACH_KM = {
  neighborhood: 5,
  city: 50,
  region: 500,
  global: null,
  online: null,
};

const reachToKm = (reach) =>
  Object.prototype.hasOwnProperty.call(REACH_KM, reach) ? REACH_KM[reach] : REACH_KM.city;

// At or below this zoom the viewport is clustered into degree-cells; above it
// individual ripples are returned.
const CLUSTER_ZOOM_MAX = 6;

/**
 * Grid cell size in degrees for a given map zoom. null = don't cluster.
 */
const cellSizeForZoom = (zoom) => {
  const z = Number(zoom);
  if (!Number.isFinite(z)) return null;
  if (z < 2) return 30;
  if (z < 3) return 15;
  if (z < 4) return 8;
  if (z < 5) return 4;
  if (z < CLUSTER_ZOOM_MAX) return 2;
  return null;
};

/**
 * Normalize a viewport bbox into 1 or 2 flat {swLng, swLat, neLng, neLat}
 * boxes. When swLng > neLng the viewport crosses the antimeridian (rotating
 * the globe past ±180° is normal) — a single box would silently match
 * nothing, so we split it. Latitude is clamped to [-90, 90].
 */
const normalizeBbox = ({ swLng, swLat, neLng, neLat }) => {
  const south = Math.max(-90, Math.min(swLat, neLat));
  const north = Math.min(90, Math.max(swLat, neLat));
  const west = Number(swLng);
  const east = Number(neLng);

  if (west <= east) {
    return [{ swLng: west, swLat: south, neLng: east, neLat: north }];
  }
  return [
    { swLng: west, swLat: south, neLng: 180, neLat: north },
    { swLng: -180, swLat: south, neLng: east, neLat: north },
  ];
};

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const EMPTY_PLACE = {
  label: '',
  neighborhood: '',
  city: '',
  state: '',
  country: '',
  countryCode: '',
  cityKey: '',
};

/**
 * Reverse-geocode a point into the Ripple.place shape. Degrades gracefully:
 * any failure (no token, no result, network error) returns empty strings
 * rather than throwing — a Ripple must still be creatable without geocoding.
 */
const resolvePlace = async (lng, lat) => {
  try {
    const geo = await mapboxService.reverseGeocodeDetailed(Number(lat), Number(lng));
    if (!geo) return { ...EMPTY_PLACE };
    const countryCode = geo.countryCode || '';
    const cityKey = countryCode && geo.city ? `${countryCode}:${slug(geo.city)}`.toLowerCase() : '';
    return { ...geo, cityKey };
  } catch (err) {
    console.warn('⚠️ [OPEN NETWORK] resolvePlace failed:', err.message);
    return { ...EMPTY_PLACE };
  }
};

/**
 * Server-side projection of lifecycle -> client-facing state. The client
 * stays dumb: it never branches on lifecycle directly.
 *   active/wrapping -> 'live' (unless startAt is still in the future)
 *   scheduled       -> 'upcoming'
 *   memory          -> 'completed'
 *   everything else (draft/cancelled/removed/unknown) -> 'completed'
 *   (non-discoverable states; a cancelled Ripple renders as ended, not joinable)
 */
const projectState = (ripple) => {
  const now = Date.now();
  switch (ripple.lifecycle) {
    case 'active':
    case 'wrapping':
      if (ripple.startAt && new Date(ripple.startAt).getTime() > now) return 'upcoming';
      return 'live';
    case 'scheduled':
      return 'upcoming';
    case 'memory':
      return 'completed';
    default:
      return 'completed';
  }
};

module.exports = {
  REACH_KM,
  reachToKm,
  CLUSTER_ZOOM_MAX,
  cellSizeForZoom,
  normalizeBbox,
  resolvePlace,
  projectState,
};
