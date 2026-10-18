// Always shared when a user signs in with Syncup — no user toggle.
const MANDATORY_IDENTITY_SCOPES = Object.freeze(['openid', 'profile', 'email']);
// Extra fields an app can request — each maps to one user-controlled setting.
const EXTRA_IDENTITY_SCOPES = Object.freeze(['phone', 'sync_id', 'picture', 'birthdate', 'gender']);
const IDENTITY_SCOPES = Object.freeze([
  ...MANDATORY_IDENTITY_SCOPES,
  ...EXTRA_IDENTITY_SCOPES,
  'offline_access',
]);
const SHARING_POLICIES = Object.freeze(['allow', 'ask', 'never']);
const BUSINESS_SCOPES = Object.freeze(['space.messages', 'space.codes', 'space.receipts', 'space.promotions']);
const ALL_SCOPES = Object.freeze([...IDENTITY_SCOPES, ...BUSINESS_SCOPES]);

module.exports = Object.freeze({
  IDENTITY_SCOPES,
  MANDATORY_IDENTITY_SCOPES,
  EXTRA_IDENTITY_SCOPES,
  SHARING_POLICIES,
  BUSINESS_SCOPES,
  ALL_SCOPES,
});
