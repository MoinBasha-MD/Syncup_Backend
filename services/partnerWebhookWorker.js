const PartnerWebhookDelivery = require('../models/PartnerWebhookDelivery');
const { deliverWebhook, loadWebhookSecret } = require('./partnerWebhooks');

const BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000, 2 * 3600 * 1000, 6 * 3600 * 1000, 12 * 3600 * 1000];
const MAX_ATTEMPTS = 7;
const LEASE_MS = 60 * 1000;
const PERMANENT_ERRORS = new Set(['blocked_address', 'invalid_url', 'not_configured']);

// Atomically lease the oldest due delivery: the lease is itself a
// nextAttemptAt bump, so a crashed worker never loses the record.
const claimNext = async (now) =>
  PartnerWebhookDelivery.findOneAndUpdate(
    { status: 'pending', nextAttemptAt: { $lte: now } },
    { $set: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) } },
    { new: true, sort: { nextAttemptAt: 1, _id: 1 } }
  );

const runWebhookDeliveries = async ({ limit = 50 } = {}) => {
  let processed = 0;
  let delivered = 0;
  let failed = 0;
  let retried = 0;

  for (let i = 0; i < limit; i += 1) {
    const now = new Date();
    const delivery = await claimNext(now);
    if (!delivery) break;
    processed += 1;

    const creds = await loadWebhookSecret(delivery.appId);
    const attempts = (delivery.attempts || 0) + 1;

    if (!creds) {
      failed += 1;
      await PartnerWebhookDelivery.updateOne(
        { _id: delivery._id },
        { $set: { status: 'failed', attempts, lastError: 'not_configured' } }
      );
      continue;
    }

    const result = await deliverWebhook(delivery, creds.url, creds.secret);
    if (result.delivered) {
      delivered += 1;
      await PartnerWebhookDelivery.updateOne(
        { _id: delivery._id },
        { $set: { status: 'delivered', attempts, lastError: '' } }
      );
      continue;
    }

    if (PERMANENT_ERRORS.has(result.error) || attempts >= MAX_ATTEMPTS) {
      failed += 1;
      await PartnerWebhookDelivery.updateOne(
        { _id: delivery._id },
        { $set: { status: 'failed', attempts, lastError: result.error || 'delivery_failed' } }
      );
      continue;
    }

    retried += 1;
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
    await PartnerWebhookDelivery.updateOne(
      { _id: delivery._id },
      {
        $set: {
          status: 'pending',
          attempts,
          lastError: result.error || 'delivery_failed',
          nextAttemptAt: new Date(now.getTime() + delay),
        },
      }
    );
  }

  return { processed, delivered, failed, retried };
};

module.exports = { runWebhookDeliveries, BACKOFF_MS, MAX_ATTEMPTS };
