// Generate a P-256 (ES256) signing key for the Sync Space OIDC provider.
// Prints the private key PEM ONCE — store it in SYNC_SPACE_OIDC_PRIVATE_KEY.
// This script never writes files.
const crypto = require('crypto');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});
const jwk = publicKey.export({ format: 'jwk' });
const kid = crypto
  .createHash('sha256')
  .update(`{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`)
  .digest('base64url');

console.log('# Add to your environment (keep it secret — never commit):');
console.log(`SYNC_SPACE_OIDC_PRIVATE_KEY="${privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n')}"`);
console.log('# kid (RFC 7638 thumbprint, informational):', kid);
console.log('# public JWK:', JSON.stringify({ ...jwk, kid, alg: 'ES256', use: 'sig' }));
