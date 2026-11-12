module.exports = function readableStatus(user, now = new Date()) {
  // The status expires at the earliest deadline either field provides; a
  // stale mainEndTime must not outlive a shorter statusUntil (the old
  // `mainEndTime || statusUntil` preferred the longer/stale one).
  const mainEndMs = [user.mainEndTime, user.statusUntil]
    .map(value => (value ? new Date(value).getTime() : null))
    .filter(value => Number.isFinite(value))
    .reduce((min, value) => (min === null || value < min ? value : min), null);
  const mainExpired = mainEndMs !== null && mainEndMs <= now.getTime();
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
