const crypto = require('crypto');
const dns = require('dns').promises;
const https = require('https');
const net = require('net');
const PartnerApp = require('../models/PartnerApp');
const PartnerWebhookDelivery = require('../models/PartnerWebhookDelivery');
const { decryptSecret } = require('../utils/syncSpaceCrypto');
const { BadRequestError } = require('../utils/errorClasses');

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.lan', '.home', '.corp'];

// Webhook URLs must be public https endpoints; validated again at delivery
// time together with DNS resolution to stop SSRF / DNS-rebinding.
const validateWebhookUrl = (raw) => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) {
    throw new BadRequestError('A valid https webhook URL is required');
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestError('A valid https webhook URL is required');
  }
  const reject = () => {
    throw new BadRequestError(
      'Webhook URL must be https, on port 443, without credentials, and point to a public hostname'
    );
  };
  if (url.protocol !== 'https:') reject();
  if (url.username || url.password) reject();
  if (url.port && url.port !== '443') reject();
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || net.isIP(hostname)) reject();
  if (hostname === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
    reject();
  }
  return url;
};

const isPrivateV4 = (a, b, c, d) =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168) ||
  (a === 198 && (b === 18 || b === 19)) ||
  a >= 224;

const expandV6 = (ip) => {
  if (ip === '::') return new Array(8).fill('0');
  const idx = ip.indexOf('::');
  if (idx === -1) return ip.split(':');
  const left = ip.slice(0, idx) ? ip.slice(0, idx).split(':') : [];
  const right = ip.slice(idx + 2) ? ip.slice(idx + 2).split(':') : [];
  return [...left, ...new Array(8 - left.length - right.length).fill('0'), ...right];
};

const isPrivateAddress = (address) => {
  if (net.isIPv4(address)) {
    const [a, b, c, d] = address.split('.').map(Number);
    return isPrivateV4(a, b, c, d);
  }
  if (!net.isIPv6(address)) return true; // unknown → refuse
  const lower = address.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const [a, b, c, d] = mapped[1].split('.').map(Number);
    return isPrivateV4(a, b, c, d);
  }
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return isPrivateV4(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
  }
  const groups = expandV6(lower).map((g) => {
    const v = parseInt(g, 16);
    return Number.isNaN(v) ? -1 : v;
  });
  if (groups.length !== 8 || groups.some((g) => g < 0)) return true; // unparseable → refuse
  if (groups.every((g) => g === 0)) return true; // :: unspecified
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if ((groups[0] & 0xfff0) === 0x2000 && groups[1] === 0x0db8) return true; // 2001:db8::/32 docs
  return false;
};

const generateWebhookSecret = () => `whsec_${crypto.randomBytes(32).toString('base64url')}`;

const signWebhook = (secret, rawBody, timestamp) =>
  crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

// Enqueue only — delivery always happens via the worker.
const enqueueConnectionEvent = async ({ appId, connection, event }) => {
  const app = await PartnerApp.findOne({ appId }).select('+webhookSecretEncrypted').lean();
  if (!app || !app.webhookUrl || !app.webhookSecretEncrypted) return null;
  const deliveryId = `whd_${crypto.randomBytes(16).toString('hex')}`;
  const payload = {
    id: deliveryId,
    type: event,
    createdAt: new Date().toISOString(),
    data: {
      subject: connection.subject,
      scopes: connection.scopes,
      status: connection.status,
      appId,
      environment: connection.environment,
    },
  };
  return PartnerWebhookDelivery.create({ deliveryId, appId, event, payload });
};

// One HTTPS POST with DNS pinned at request time. Never follows redirects and
// reads at most 1KB of the response body. Resolved failures return
// { delivered:false, error:'<short code>' } instead of throwing.
const deliverWebhook = async (delivery, webhookUrl, secret, deps = {}) => {
  const lookup = deps.lookup || ((h, o) => dns.lookup(h, o));
  const request = deps.request || https.request;

  let url;
  try {
    url = validateWebhookUrl(webhookUrl);
  } catch {
    return { delivered: false, error: 'invalid_url' };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return { delivered: false, error: 'dns_failed' };
  }
  if (!addresses || addresses.length === 0) {
    return { delivered: false, error: 'dns_failed' };
  }
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    return { delivered: false, error: 'blocked_address' };
  }
  const target = addresses[0];

  const rawBody = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signWebhook(secret, rawBody, timestamp);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let req;
    try {
      req = request(
        {
          protocol: 'https:',
          hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          servername: hostname,
          agent: false,
          timeout: 5000,
          // Node ≥20 calls lookup with { all: true } when autoSelectFamily is
          // on — answer both call shapes with the pinned address only.
          lookup: (_host, opts, cb) =>
            opts && opts.all
              ? cb(null, [{ address: target.address, family: target.family }])
              : cb(null, target.address, target.family),
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(rawBody),
            'Syncup-Event': delivery.event,
            'Syncup-Delivery': delivery.deliveryId,
            'Syncup-Signature': `t=${timestamp},v1=${signature}`,
          },
        },
        (res) => {
          let bytes = 0;
          res.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > 1024) {
              // 'end' may never fire after destroy — settle on the status now.
              const ok = res.statusCode >= 200 && res.statusCode < 300;
              finish({ delivered: ok, error: ok ? '' : `http_${res.statusCode}` });
              req.destroy();
            }
          });
          res.on('end', () => {
            const ok = res.statusCode >= 200 && res.statusCode < 300;
            finish({ delivered: ok, error: ok ? '' : `http_${res.statusCode}` });
          });
          res.on('error', () => finish({ delivered: false, error: 'request_failed' }));
          res.resume();
        }
      );
    } catch {
      return finish({ delivered: false, error: 'request_failed' });
    }
    // Destroyed sockets must never leave the promise hanging.
    req.on('close', () => finish({ delivered: false, error: 'request_failed' }));
    req.on('timeout', () => {
      req.destroy();
      finish({ delivered: false, error: 'timeout' });
    });
    req.on('error', () => finish({ delivered: false, error: 'request_failed' }));
    req.end(rawBody);
  });
};

const loadWebhookSecret = async (appId) => {
  const app = await PartnerApp.findOne({ appId }).select('+webhookSecretEncrypted').lean();
  if (!app || !app.webhookUrl || !app.webhookSecretEncrypted) return null;
  return {
    url: app.webhookUrl,
    secret: decryptSecret(app.webhookSecretEncrypted, `webhook:${appId}`),
  };
};

module.exports = {
  validateWebhookUrl,
  isPrivateAddress,
  generateWebhookSecret,
  signWebhook,
  enqueueConnectionEvent,
  deliverWebhook,
  loadWebhookSecret,
};
