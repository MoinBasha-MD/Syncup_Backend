const { BadRequestError } = require('../utils/errorClasses');

/**
 * API Versioning Middleware
 * Supports versioning via:
 * 1. URL path: /api/v1/users
 * 2. Accept header: Accept: application/vnd.api+json;version=1
 * 3. Custom header: X-API-Version: 1
 */

const SUPPORTED_VERSIONS = ['1', '2']; // Add new versions here
const DEFAULT_VERSION = '1';

const apiVersioning = (req, res, next) => {
  let version = DEFAULT_VERSION;

  // 1. Check URL path for version (highest priority)
  const pathVersion = req.path.match(/^\/api\/v(\d+)\//);
  if (pathVersion) {
    version = pathVersion[1];
    // Remove version from path for downstream processing
    req.url = req.url.replace(/\/v\d+/, '');
    req.path = req.path.replace(/\/v\d+/, '');
  }
  // 2. Check custom header
  else if (req.headers['x-api-version']) {
    version = req.headers['x-api-version'];
  }
  // 3. Check Accept header
  else if (req.headers.accept) {
    const acceptVersion = req.headers.accept.match(/version=(\d+)/);
    if (acceptVersion) {
      version = acceptVersion[1];
    }
  }

  // Validate version
  if (!SUPPORTED_VERSIONS.includes(version)) {
    return next(new BadRequestError(
      `API version ${version} is not supported. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}`
    ));
  }

  // Add version info to request
  req.apiVersion = version;
  
  // Add version info to response headers
  res.set('X-API-Version', version);
  res.set('X-Supported-Versions', SUPPORTED_VERSIONS.join(', '));

  next();
};

/**
 * Version-specific route handler
 * Usage: versionHandler({ '1': handlerV1, '2': handlerV2 })
 */
const versionHandler = (handlers) => {
  return (req, res, next) => {
    const version = req.apiVersion || DEFAULT_VERSION;
    const handler = handlers[version];
    
    if (!handler) {
      return next(new BadRequestError(
        `No handler available for API version ${version}`
      ));
    }
    
    return handler(req, res, next);
  };
};

/**
 * Deprecation warning middleware
 */
const deprecationWarning = (version, message, sunsetDate) => {
  return (req, res, next) => {
    if (req.apiVersion === version) {
      res.set('Warning', `299 - "API version ${version} is deprecated. ${message}"`);
      if (sunsetDate) {
        res.set('Sunset', sunsetDate);
      }
    }
    next();
  };
};

module.exports = {
  apiVersioning,
  versionHandler,
  deprecationWarning,
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION
};
