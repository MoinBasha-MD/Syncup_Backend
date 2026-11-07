const WaitlistEntry = require('../../models/WaitlistEntry');
const { ok, fail, handle } = require('../../utils/adminV2Response');

const OWNER_ROLES = new Set(['owner', 'super_admin']);

/**
 * GET /waitlist — names and emails are PII; owner/super_admin only, matching
 * the legacy endpoint's restriction.
 */
const listWaitlist = handle(async (req, res) => {
  if (!req.admin || !OWNER_ROLES.has(req.admin.role)) {
    return fail(res, 403, 'FORBIDDEN', 'Owner or super admin access required');
  }

  const requested = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 1000) : 1000;

  const [entries, count] = await Promise.all([
    WaitlistEntry.find()
      .sort({ _id: -1 })
      .limit(limit)
      .select('name email source createdAt')
      .lean(),
    WaitlistEntry.countDocuments(),
  ]);

  return ok(res, {
    count,
    entries: entries.map((entry) => ({
      id: String(entry._id),
      name: entry.name,
      email: entry.email,
      source: entry.source || null,
      createdAt: entry.createdAt,
    })),
  });
});

module.exports = { listWaitlist };
