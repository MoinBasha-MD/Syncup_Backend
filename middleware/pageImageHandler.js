/**
 * Page Image Handler Middleware
 * Ensures page images are properly constructed with full URLs
 */

const ENV_CONFIG = {
  API_BASE_URL: process.env.API_BASE_URL || 'http://45.129.86.96:5000',
  SOCKET_URL: process.env.SOCKET_URL || 'http://45.129.86.96:5000'
};

// Log the actual URL being used
console.log('🔧 [PAGE IMAGE HANDLER] ENV_CONFIG.SOCKET_URL:', ENV_CONFIG.SOCKET_URL);

/**
 * Construct full image URL from relative path
 * @param {string} imagePath - Relative or full image path
 * @returns {string} Full image URL or empty string
 */
const constructImageUrl = (imagePath) => {
  if (!imagePath || imagePath.trim() === '') {
    return '';
  }

  const trimmedPath = imagePath.trim();

  // Already a full URL
  if (trimmedPath.startsWith('http://') || trimmedPath.startsWith('https://')) {
    return trimmedPath;
  }

  // Ensure path starts with /
  const cleanPath = trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;

  // Get base URL and ensure it doesn't end with /api
  let baseUrl = ENV_CONFIG.SOCKET_URL;
  console.log('🔧 [IMAGE URL] Original baseUrl:', baseUrl);
  
  // Remove /api from end if present
  if (baseUrl.endsWith('/api')) {
    baseUrl = baseUrl.slice(0, -4);
    console.log('🔧 [IMAGE URL] Removed /api, now:', baseUrl);
  }
  // Remove trailing slash if present
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
    console.log('🔧 [IMAGE URL] Removed trailing slash, now:', baseUrl);
  }
  
  const finalUrl = `${baseUrl}${cleanPath}`;
  console.log('🔧 [IMAGE URL] Final URL:', finalUrl);
  
  return finalUrl;
};

/**
 * Middleware to process page images in response
 * Adds full URLs for profileImage and coverImage
 */
const processPageImages = (req, res, next) => {
  // Store original json method
  const originalJson = res.json;

  // Override json method
  res.json = function(data) {
    if (data && typeof data === 'object') {
      // Handle single page
      if (data.page) {
        data.page = processPageObject(data.page);
      }

      // Handle array of pages
      if (data.pages && Array.isArray(data.pages)) {
        data.pages = data.pages.map(page => processPageObject(page));
      }
    }

    // Call original json method
    return originalJson.call(this, data);
  };

  next();
};

/**
 * Process a single page object to add full image URLs
 * @param {Object} page - Page object
 * @returns {Object} Page object with full image URLs
 */
const processPageObject = (page) => {
  if (!page || typeof page !== 'object') {
    return page;
  }

  // Convert Mongoose documents to plain objects before spreading.
  // Mongoose stores field values in an internal _doc property, so
  // { ...mongooseDoc } loses name/username/pageType/etc. and the
  // frontend receives undefined fields ("Untitled" bug).
  const plain = (typeof page.toObject === 'function') ? page.toObject({ getters: true, virtuals: false }) : { ...page };

  // Create a copy to avoid mutating original
  const processedPage = { ...plain };

  // Process profileImage
  if (processedPage.profileImage) {
    const fullUrl = constructImageUrl(processedPage.profileImage);
    processedPage.profileImageUrl = fullUrl;
    console.log(`🖼️ [PAGE IMAGE] Profile: ${processedPage.profileImage} → ${fullUrl}`);
  } else {
    processedPage.profileImageUrl = '';
    console.log(`🖼️ [PAGE IMAGE] Profile: empty → using placeholder`);
  }

  // Process coverImage
  if (processedPage.coverImage) {
    const fullUrl = constructImageUrl(processedPage.coverImage);
    processedPage.coverImageUrl = fullUrl;
    console.log(`🖼️ [PAGE IMAGE] Cover: ${processedPage.coverImage} → ${fullUrl}`);
  } else {
    processedPage.coverImageUrl = '';
    console.log(`🖼️ [PAGE IMAGE] Cover: empty → using placeholder`);
  }

  // Process owner profileImage if populated
  if (processedPage.owner && typeof processedPage.owner === 'object' && processedPage.owner.profileImage) {
    processedPage.owner.profileImageUrl = constructImageUrl(processedPage.owner.profileImage);
  }

  return processedPage;
};

module.exports = {
  processPageImages,
  constructImageUrl,
  processPageObject
};
