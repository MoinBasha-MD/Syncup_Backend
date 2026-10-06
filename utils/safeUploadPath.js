const path = require('path');

/**
 * Resolve a client-supplied filename inside uploads/<subdir> safely.
 * Returns the absolute path, or null if the filename is anything other than a
 * plain single-segment name (blocks %2F-decoded traversal like '../../.env').
 */
const resolveUploadPath = (subdir, filename) => {
  if (typeof filename !== 'string' || filename.length === 0 || filename.length > 255) {
    return null;
  }
  if (filename.includes('\0') || filename.includes('/') || filename.includes('\\')) {
    return null;
  }
  if (filename === '.' || filename === '..') {
    return null;
  }
  if (filename !== path.basename(filename)) {
    return null;
  }

  const baseDir = path.resolve(__dirname, '..', 'uploads', subdir);
  const resolved = path.resolve(baseDir, filename);
  if (!resolved.startsWith(baseDir + path.sep)) {
    return null;
  }
  return resolved;
};

module.exports = { resolveUploadPath };
