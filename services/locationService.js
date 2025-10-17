/**
 * Location Service - Utility functions for location calculations
 */

class LocationService {
  /**
   * Calculate distance between two coordinates using Haversine formula
   * @param {number} lat1 - Latitude of point 1
   * @param {number} lon1 - Longitude of point 1
   * @param {number} lat2 - Latitude of point 2
   * @param {number} lon2 - Longitude of point 2
   * @returns {number} Distance in kilometers
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return Math.round(distance * 10) / 10; // Round to 1 decimal place
  }

  /**
   * Convert degrees to radians
   * @param {number} deg 
   * @returns {number}
   */
  deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  /**
   * Validate coordinates
   * @param {number} latitude 
   * @param {number} longitude 
   * @returns {boolean}
   */
  validateCoordinates(latitude, longitude) {
    return (
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  /**
   * Round coordinates to specified decimal places
   * @param {number} coordinate 
   * @param {number} decimals 
   * @returns {number}
   */
  roundCoordinate(coordinate, decimals = 3) {
    const multiplier = Math.pow(10, decimals);
    return Math.round(coordinate * multiplier) / multiplier;
  }

  /**
   * Create GeoJSON point from coordinates
   * @param {number} longitude 
   * @param {number} latitude 
   * @returns {Object}
   */
  createGeoJSONPoint(longitude, latitude) {
    return {
      type: 'Point',
      coordinates: [longitude, latitude]
    };
  }

  /**
   * Check if location is within radius
   * @param {number} lat1 
   * @param {number} lon1 
   * @param {number} lat2 
   * @param {number} lon2 
   * @param {number} radiusKm 
   * @returns {boolean}
   */
  isWithinRadius(lat1, lon1, lat2, lon2, radiusKm) {
    const distance = this.calculateDistance(lat1, lon1, lat2, lon2);
    return distance <= radiusKm;
  }

  /**
   * Get bounding box for a location with radius
   * @param {number} latitude 
   * @param {number} longitude 
   * @param {number} radiusKm 
   * @returns {Object} Bounding box coordinates
   */
  getBoundingBox(latitude, longitude, radiusKm) {
    const latDelta = radiusKm / 111.32; // 1 degree latitude ≈ 111.32 km
    const lonDelta = radiusKm / (111.32 * Math.cos(this.deg2rad(latitude)));

    return {
      minLat: latitude - latDelta,
      maxLat: latitude + latDelta,
      minLon: longitude - lonDelta,
      maxLon: longitude + lonDelta
    };
  }

  /**
   * Format distance for display
   * @param {number} distanceKm 
   * @returns {string}
   */
  formatDistance(distanceKm) {
    if (distanceKm < 1) {
      return `${Math.round(distanceKm * 1000)} m`;
    }
    return `${distanceKm.toFixed(1)} km`;
  }
}

module.exports = new LocationService();
