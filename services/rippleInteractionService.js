const Ripple = require('../models/Ripple');
const RippleInteractor = require('../models/RippleInteractor');

const recordRippleInteractor = async (rippleId, userId) => {
  if (!rippleId || !userId) return false;

  try {
    const result = await RippleInteractor.updateOne(
      { rippleId, userId },
      { $setOnInsert: { rippleId, userId } },
      { upsert: true },
    );
    if (!result.upsertedCount) return false;

    await Ripple.updateOne({ _id: rippleId }, { $inc: { 'counts.interactors': 1 } });
    return true;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
};

module.exports = { recordRippleInteractor };
