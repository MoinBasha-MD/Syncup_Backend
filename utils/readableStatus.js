module.exports = function readableStatus(user, now = new Date()) {
  const mainEnd = user.mainEndTime || user.statusUntil;
  const mainExpired = mainEnd && new Date(mainEnd) <= now;
  const subExpired = mainExpired || (user.subEndTime && new Date(user.subEndTime) <= now);
  return {
    status: mainExpired ? 'Available' : user.status,
    customStatus: mainExpired ? '' : user.customStatus,
    statusUntil: mainExpired ? null : user.statusUntil,
    statusLocation: mainExpired ? null : user.statusLocation,
    mainStatus: mainExpired ? 'Available' : user.mainStatus,
    mainDuration: mainExpired ? 0 : user.mainDuration,
    mainDurationLabel: mainExpired ? '' : user.mainDurationLabel,
    mainStartTime: mainExpired ? null : user.mainStartTime,
    mainEndTime: mainExpired ? null : user.mainEndTime,
    subStatus: subExpired ? null : user.subStatus,
    subDuration: subExpired ? 0 : user.subDuration,
    subDurationLabel: subExpired ? '' : user.subDurationLabel,
    subStartTime: subExpired ? null : user.subStartTime,
    subEndTime: subExpired ? null : user.subEndTime,
    primaryTimeProfileId: mainExpired ? null : (user.primaryTimeProfileId || null),
  };
};
