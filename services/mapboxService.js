const mbxClient = require('@mapbox/mapbox-sdk');
const mbxGeocoding = require('@mapbox/mapbox-sdk/services/geocoding');

class MapboxService {
  constructor() {
    const accessToken = process.env.MAPBOX_PUBLIC_TOKEN;
    
    if (!accessToken) {
      console.warn('⚠️ MAPBOX_PUBLIC_TOKEN not found in environment variables');
      this.client = null;
      this.geocodingClient = null;
      return;
    }

    this.client = mbxClient({ accessToken });
    this.geocodingClient = mbxGeocoding(this.client);
  }

  /**
   * Reverse geocode - Convert coordinates to address
   * @param {number} latitude 
   * @param {number} longitude 
   * @returns {Promise<Object>} Address information
   */
  async reverseGeocode(latitude, longitude) {
    try {
      if (!this.geocodingClient) {
        throw new Error('Mapbox client not initialized');
      }

      const response = await this.geocodingClient
        .reverseGeocode({
          query: [longitude, latitude],
          limit: 1,
          types: ['place', 'locality', 'neighborhood', 'address', 'poi']
        })
        .send();

      if (!response.body.features || response.body.features.length === 0) {
        return {
          placeName: 'Unknown Location',
          fullAddress: 'Unknown Address',
          city: '',
          country: ''
        };
      }

      const feature = response.body.features[0];
      
      // Extract city and country from context
      let city = '';
      let country = '';
      
      if (feature.context) {
        const placeContext = feature.context.find(c => c.id.startsWith('place'));
        const countryContext = feature.context.find(c => c.id.startsWith('country'));
        
        city = placeContext ? placeContext.text : '';
        country = countryContext ? countryContext.text : '';
      }

      return {
        placeName: feature.text || 'Unknown Place',
        fullAddress: feature.place_name || 'Unknown Address',
        city: city,
        country: country,
        coordinates: {
          latitude: feature.center[1],
          longitude: feature.center[0]
        }
      };
    } catch (error) {
      console.error('❌ Reverse geocoding error:', error.message);
      return {
        placeName: 'Unknown Location',
        fullAddress: 'Unknown Address',
        city: '',
        country: ''
      };
    }
  }

  /**
   * Forward geocode - Convert address to coordinates
   * @param {string} query - Address or place name
   * @param {number} limit - Number of results
   * @returns {Promise<Array>} Array of places
   */
  async forwardGeocode(query, limit = 5) {
    try {
      if (!this.geocodingClient) {
        throw new Error('Mapbox client not initialized');
      }

      const response = await this.geocodingClient
        .forwardGeocode({
          query: query,
          limit: limit,
          types: ['place', 'locality', 'neighborhood', 'address', 'poi']
        })
        .send();

      if (!response.body.features || response.body.features.length === 0) {
        return [];
      }

      return response.body.features.map(feature => ({
        placeName: feature.text,
        fullAddress: feature.place_name,
        coordinates: {
          latitude: feature.center[1],
          longitude: feature.center[0]
        }
      }));
    } catch (error) {
      console.error('❌ Forward geocoding error:', error.message);
      return [];
    }
  }

  /**
   * Search places near a location
   * @param {string} query - Search query
   * @param {number} latitude 
   * @param {number} longitude 
   * @param {number} limit 
   * @returns {Promise<Array>} Array of nearby places
   */
  async searchNearby(query, latitude, longitude, limit = 5) {
    try {
      if (!this.geocodingClient) {
        throw new Error('Mapbox client not initialized');
      }

      const response = await this.geocodingClient
        .forwardGeocode({
          query: query,
          proximity: [longitude, latitude],
          limit: limit,
          types: ['poi', 'address']
        })
        .send();

      if (!response.body.features || response.body.features.length === 0) {
        return [];
      }

      return response.body.features.map(feature => ({
        placeName: feature.text,
        fullAddress: feature.place_name,
        coordinates: {
          latitude: feature.center[1],
          longitude: feature.center[0]
        }
      }));
    } catch (error) {
      console.error('❌ Search nearby error:', error.message);
      return [];
    }
  }

  /**
   * Generate static map image URL
   * @param {number} latitude 
   * @param {number} longitude 
   * @param {number} zoom 
   * @param {number} width 
   * @param {number} height 
   * @returns {string} Static map URL
   */
  getStaticMapUrl(latitude, longitude, zoom = 15, width = 300, height = 200) {
    const accessToken = process.env.MAPBOX_PUBLIC_TOKEN;
    
    if (!accessToken) {
      return '';
    }

    return `https://api.mapbox.com/styles/v1/mapbox/streets-v11/static/` +
           `pin-s+ff0000(${longitude},${latitude})/` +
           `${longitude},${latitude},${zoom}/` +
           `${width}x${height}` +
           `?access_token=${accessToken}`;
  }
}

module.exports = new MapboxService();
