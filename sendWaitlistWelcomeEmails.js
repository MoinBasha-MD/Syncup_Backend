// One-time (and safe to rerun) welcome-email backfill for waitlist entries.
// Rows already emailed have welcomeEmailSentAt set and are skipped.
// Usage: node sendWaitlistWelcomeEmails.js [--dry-run]
const mongoose = require('mongoose');
require('dotenv').config();

const WaitlistEntry = require('./models/WaitlistEntry');
const emailService = require('./services/emailService');

const DRY_RUN = process.argv.includes('--dry-run');
const SEND_DELAY_MS = 500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
    console.error('EMAIL_USER and EMAIL_APP_PASSWORD must be set. Nothing sent.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const entries = await WaitlistEntry.find({ welcomeEmailSentAt: null })
    .select('name email')
    .lean();

  console.log(`${entries.length} waitlist entr${entries.length === 1 ? 'y' : 'ies'} pending a welcome email.`);

  let sent = 0;
  let failed = 0;

  for (const entry of entries) {
    if (DRY_RUN) {
      console.log(`[dry-run] ${entry.name} <${entry.email}>`);
      continue;
    }

    const result = await emailService.sendWaitlistWelcome(entry.email, entry.name);
    if (result.success) {
      await WaitlistEntry.updateOne(
        { _id: entry._id },
        { $set: { welcomeEmailSentAt: new Date() } }
      );
      sent += 1;
      console.log(`sent ${sent}/${entries.length} — ${entry.email}`);
    } else {
      failed += 1;
      console.error(`failed — ${entry.email}: ${result.error}`);
    }

    await sleep(SEND_DELAY_MS);
  }

  console.log(DRY_RUN ? 'Dry run only; nothing sent.' : `Done. Sent ${sent}, failed ${failed}.`);
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
