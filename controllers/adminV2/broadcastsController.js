const Broadcast = require('../../models/Broadcast');
const User = require('../../models/userModel');
const { ok, fail, handle, parseLimit, isValidObjectId } = require('../../utils/adminV2Response');

// ---------------------------------------------------------------------------
// Shared core logic — used by BOTH the legacy /api/admin handlers (which keep
// their historical response shapes) and the /api/admin/v2 envelope handlers.
// ---------------------------------------------------------------------------

const countRecipients = async ({ targetAudience, customTargeting }) => {
  switch (targetAudience) {
    case 'all':
      return User.countDocuments();
    case 'active':
      return User.countDocuments({ isOnline: true });
    case 'inactive':
      return User.countDocuments({ isOnline: false });
    case 'premium':
      return User.countDocuments({ isPremium: true });
    case 'new_users': {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });
    }
    case 'custom': {
      const targetQuery = {};
      if (customTargeting) {
        if (customTargeting.userIds && customTargeting.userIds.length > 0) {
          targetQuery.userId = { $in: customTargeting.userIds };
        }
        if (customTargeting.minAge || customTargeting.maxAge) {
          const now = new Date();
          if (customTargeting.maxAge) {
            const minBirthDate = new Date(now.getFullYear() - customTargeting.maxAge, now.getMonth(), now.getDate());
            targetQuery.dateOfBirth = { $gte: minBirthDate };
          }
          if (customTargeting.minAge) {
            const maxBirthDate = new Date(now.getFullYear() - customTargeting.minAge, now.getMonth(), now.getDate());
            targetQuery.dateOfBirth = { ...targetQuery.dateOfBirth, $lte: maxBirthDate };
          }
        }
        if (customTargeting.lastActiveWithin) {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - customTargeting.lastActiveWithin);
          targetQuery.lastSeen = { $gte: cutoffDate };
        }
        if (customTargeting.registeredAfter) {
          targetQuery.createdAt = { ...targetQuery.createdAt, $gte: new Date(customTargeting.registeredAfter) };
        }
        if (customTargeting.registeredBefore) {
          targetQuery.createdAt = { ...targetQuery.createdAt, $lte: new Date(customTargeting.registeredBefore) };
        }
      }
      return User.countDocuments(targetQuery);
    }
    default:
      return 0;
  }
};

const createBroadcastCore = async (body, req) => {
  const {
    title, message, type, priority, targetAudience, link, imageUrl, expiresAt,
    scheduledFor, buttons, customTargeting, saveAsTemplate, templateName,
  } = body;

  const recipientCount = await countRecipients({ targetAudience, customTargeting });

  const isScheduled = scheduledFor && new Date(scheduledFor) > new Date();
  const status = isScheduled ? 'scheduled' : 'sent';

  const broadcast = await Broadcast.create({
    title,
    message,
    type: type || 'announcement',
    priority: priority || 'medium',
    targetAudience: targetAudience || 'all',
    customTargeting: targetAudience === 'custom' ? customTargeting : undefined,
    sentBy: 'admin',
    sentByName: 'System Admin',
    recipientCount,
    link,
    imageUrl,
    buttons: buttons || [],
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    status,
    isTemplate: saveAsTemplate || false,
    templateName: saveAsTemplate ? templateName : undefined,
    sentAt: isScheduled ? null : new Date(),
  });

  if (!isScheduled) {
    try {
      const io = req.app.get('io');
      if (io) {
        io.emit('admin:broadcast', {
          id: broadcast._id,
          title: broadcast.title,
          message: broadcast.message,
          type: broadcast.type,
          priority: broadcast.priority,
          link: broadcast.link,
          imageUrl: broadcast.imageUrl,
          buttons: broadcast.buttons,
          sentAt: broadcast.sentAt,
          expiresAt: broadcast.expiresAt,
        });
      }
    } catch (socketError) {
      console.error('❌ [ADMIN] Error emitting broadcast via socket:', socketError);
    }
  }

  return { broadcast, recipientCount, isScheduled };
};

const analyticsFor = (broadcast) => {
  const deliveryRate = broadcast.recipientCount > 0
    ? ((broadcast.recipientCount - (broadcast.dismissCount || 0)) / broadcast.recipientCount * 100).toFixed(2)
    : 0;
  const readRate = broadcast.recipientCount > 0
    ? (broadcast.readCount / broadcast.recipientCount * 100).toFixed(2)
    : 0;
  const clickRate = broadcast.readCount > 0
    ? (broadcast.clickCount / broadcast.readCount * 100).toFixed(2)
    : 0;
  return {
    deliveryRate: parseFloat(deliveryRate),
    readRate: parseFloat(readRate),
    clickRate: parseFloat(clickRate),
    totalEngagement: broadcast.readCount + broadcast.clickCount,
    dismissRate: broadcast.recipientCount > 0
      ? ((broadcast.dismissCount || 0) / broadcast.recipientCount * 100).toFixed(2)
      : 0,
  };
};

// ---------------------------------------------------------------------------
// Legacy handlers — mounted from routes/adminDashboardRoutes.js, response
// shapes preserved exactly as before.
// ---------------------------------------------------------------------------

const legacyList = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const broadcasts = await Broadcast.find().sort({ sentAt: -1 }).skip(skip).limit(limit).lean();
    const total = await Broadcast.countDocuments();
    res.json({ broadcasts, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching broadcasts:', error);
    res.status(500).json({ error: 'Failed to fetch broadcasts' });
  }
};

const legacyCreate = async (req, res) => {
  try {
    const { broadcast, recipientCount, isScheduled } = await createBroadcastCore(req.body, req);
    res.json({
      message: isScheduled ? 'Broadcast scheduled successfully' : 'Broadcast sent successfully',
      broadcast,
      recipientCount,
      scheduled: isScheduled,
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error creating broadcast:', error);
    res.status(500).json({ error: 'Failed to send broadcast' });
  }
};

const legacyStats = async (req, res) => {
  try {
    const [totalBroadcasts, totalRecipients, totalReads, recentBroadcasts] = await Promise.all([
      Broadcast.countDocuments(),
      Broadcast.aggregate([{ $group: { _id: null, total: { $sum: '$recipientCount' } } }]),
      Broadcast.aggregate([{ $group: { _id: null, total: { $sum: '$readCount' } } }]),
      Broadcast.countDocuments({ sentAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
    ]);
    res.json({
      totalBroadcasts,
      totalRecipients: totalRecipients[0]?.total || 0,
      totalReads: totalReads[0]?.total || 0,
      recentBroadcasts,
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching broadcast stats:', error);
    res.status(500).json({ error: 'Failed to fetch broadcast stats' });
  }
};

const legacyTemplates = async (req, res) => {
  try {
    const templates = await Broadcast.find({ isTemplate: true })
      .select('title message type priority targetAudience link imageUrl buttons templateName')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ templates });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
};

const legacyScheduled = async (req, res) => {
  try {
    const scheduled = await Broadcast.find({ status: 'scheduled', scheduledFor: { $gt: new Date() } })
      .sort({ scheduledFor: 1 })
      .lean();
    res.json({ scheduled });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching scheduled broadcasts:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled broadcasts' });
  }
};

const legacyCancel = async (req, res) => {
  try {
    const broadcast = await Broadcast.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    res.json({ message: 'Broadcast cancelled successfully', broadcast });
  } catch (error) {
    console.error('❌ [ADMIN] Error cancelling broadcast:', error);
    res.status(500).json({ error: 'Failed to cancel broadcast' });
  }
};

const legacyAnalytics = async (req, res) => {
  try {
    const broadcast = await Broadcast.findById(req.params.id).lean();
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    res.json({ ...broadcast, analytics: analyticsFor(broadcast) });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching broadcast analytics:', error);
    res.status(500).json({ error: 'Failed to fetch broadcast analytics' });
  }
};

const legacyUpdate = async (req, res) => {
  try {
    const broadcast = await Broadcast.findById(req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    if (broadcast.status !== 'draft' && broadcast.status !== 'scheduled') {
      return res.status(400).json({ error: 'Cannot edit sent broadcasts' });
    }
    Object.assign(broadcast, req.body);
    await broadcast.save();
    res.json({ message: 'Broadcast updated successfully', broadcast });
  } catch (error) {
    console.error('❌ [ADMIN] Error updating broadcast:', error);
    res.status(500).json({ error: 'Failed to update broadcast' });
  }
};

const legacyDelete = async (req, res) => {
  try {
    const broadcast = await Broadcast.findByIdAndDelete(req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    res.json({ message: 'Broadcast deleted successfully' });
  } catch (error) {
    console.error('❌ [ADMIN] Error deleting broadcast:', error);
    res.status(500).json({ error: 'Failed to delete broadcast' });
  }
};

// ---------------------------------------------------------------------------
// v2 handlers — envelope responses.
// ---------------------------------------------------------------------------

const v2List = handle(async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const filter = {};
  if (req.query.cursor && isValidObjectId(req.query.cursor)) {
    filter._id = { $lt: req.query.cursor };
  }
  const docs = await Broadcast.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const page = docs.slice(0, limit);
  const nextCursor = docs.length > limit ? String(page[page.length - 1]._id) : null;
  return ok(res, page, nextCursor);
});

const v2Create = handle(async (req, res) => {
  const result = await createBroadcastCore(req.body, req);
  res.locals.auditAfter = { id: result.broadcast._id, status: result.broadcast.status, recipientCount: result.recipientCount };
  return ok(res, {
    broadcast: result.broadcast,
    recipientCount: result.recipientCount,
    scheduled: result.isScheduled,
  });
});

const v2Stats = handle(async (req, res) => {
  const [totalBroadcasts, totalRecipients, totalReads, recentBroadcasts] = await Promise.all([
    Broadcast.countDocuments(),
    Broadcast.aggregate([{ $group: { _id: null, total: { $sum: '$recipientCount' } } }]),
    Broadcast.aggregate([{ $group: { _id: null, total: { $sum: '$readCount' } } }]),
    Broadcast.countDocuments({ sentAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
  ]);
  return ok(res, {
    totalBroadcasts,
    totalRecipients: totalRecipients[0]?.total || 0,
    totalReads: totalReads[0]?.total || 0,
    recentBroadcasts,
  });
});

const v2Templates = handle(async (req, res) => {
  const templates = await Broadcast.find({ isTemplate: true })
    .select('title message type priority targetAudience link imageUrl buttons templateName')
    .sort({ createdAt: -1 })
    .lean();
  return ok(res, templates);
});

const v2Scheduled = handle(async (req, res) => {
  const scheduled = await Broadcast.find({ status: 'scheduled', scheduledFor: { $gt: new Date() } })
    .sort({ scheduledFor: 1 })
    .lean();
  return ok(res, scheduled);
});

const v2Cancel = handle(async (req, res) => {
  const broadcast = await Broadcast.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
  if (!broadcast) return fail(res, 404, 'NOT_FOUND', 'Broadcast not found');
  res.locals.auditAfter = { status: 'cancelled' };
  return ok(res, broadcast);
});

const v2Analytics = handle(async (req, res) => {
  const broadcast = await Broadcast.findById(req.params.id).lean();
  if (!broadcast) return fail(res, 404, 'NOT_FOUND', 'Broadcast not found');
  return ok(res, { ...broadcast, analytics: analyticsFor(broadcast) });
});

const v2Update = handle(async (req, res) => {
  const broadcast = await Broadcast.findById(req.params.id);
  if (!broadcast) return fail(res, 404, 'NOT_FOUND', 'Broadcast not found');
  if (broadcast.status !== 'draft' && broadcast.status !== 'scheduled') {
    return fail(res, 400, 'BAD_REQUEST', 'Cannot edit sent broadcasts');
  }
  res.locals.auditBefore = broadcast.toObject();
  Object.assign(broadcast, req.body);
  await broadcast.save();
  res.locals.auditAfter = broadcast.toObject();
  return ok(res, broadcast);
});

const v2Delete = handle(async (req, res) => {
  const broadcast = await Broadcast.findByIdAndDelete(req.params.id);
  if (!broadcast) return fail(res, 404, 'NOT_FOUND', 'Broadcast not found');
  res.locals.auditAfter = { deleted: true };
  return ok(res, { deleted: true });
});

module.exports = {
  legacy: {
    list: legacyList,
    create: legacyCreate,
    stats: legacyStats,
    templates: legacyTemplates,
    scheduled: legacyScheduled,
    cancel: legacyCancel,
    analytics: legacyAnalytics,
    update: legacyUpdate,
    delete: legacyDelete,
  },
  v2: {
    list: v2List,
    create: v2Create,
    stats: v2Stats,
    templates: v2Templates,
    scheduled: v2Scheduled,
    cancel: v2Cancel,
    analytics: v2Analytics,
    update: v2Update,
    delete: v2Delete,
  },
};
