// Escape a user-supplied string before using it in a RegExp/$regex.
const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
module.exports = escapeRegex;
