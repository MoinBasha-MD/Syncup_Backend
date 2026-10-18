const IDENTITY_SCOPES = Object.freeze(['openid', 'profile', 'email', 'phone', 'sync_id', 'offline_access']);
const BUSINESS_SCOPES = Object.freeze(['space.messages', 'space.codes', 'space.receipts', 'space.promotions']);
const ALL_SCOPES = Object.freeze([...IDENTITY_SCOPES, ...BUSINESS_SCOPES]);

module.exports = Object.freeze({ IDENTITY_SCOPES, BUSINESS_SCOPES, ALL_SCOPES });
