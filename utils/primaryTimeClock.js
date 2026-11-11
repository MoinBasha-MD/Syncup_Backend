const formatters = new Map();

function isValidTimezone(timezone) {
  if (typeof timezone !== 'string' || !timezone || timezone.length > 100) return false;
  if (formatters.has(timezone)) return true;
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    formatter.format(new Date());
    formatters.set(timezone, formatter);
    return true;
  } catch {
    return false;
  }
}

function localDate(profile, instant) {
  if (!isValidTimezone(profile.timezone)) {
    return new Date(instant.getTime() - (profile.timezoneOffset || 0) * 60000);
  }
  const formatter = formatters.get(profile.timezone);
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day,
    +parts.hour, +parts.minute, +parts.second, instant.getUTCMilliseconds()));
}

function resolveLocalTime(profile, wallTime) {
  const target = wallTime.getTime();
  if (!isValidTimezone(profile.timezone)) {
    return new Date(target + (profile.timezoneOffset || 0) * 60000);
  }
  const offsets = new Set([-2, -1, 0, 1, 2].map(days => {
    const instant = new Date(target + days * 86400000);
    return localDate(profile, instant).getTime() - instant.getTime();
  }));
  const candidates = [...offsets].map(offset => {
    const instant = new Date(target - offset);
    return { instant, delta: localDate(profile, instant).getTime() - target };
  });
  const exact = candidates.filter(c => c.delta === 0).sort((a, b) => a.instant - b.instant);
  if (exact.length) return exact[0].instant;
  return candidates.filter(c => c.delta > 0).sort((a, b) => a.delta - b.delta)[0]?.instant || candidates[0].instant;
}

function activeWindow(profile, now = new Date()) {
  const localNow = localDate(profile, now);
  const today = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()));
  const [startHour, startMinute] = profile.startTime.split(':').map(Number);
  const [endHour, endMinute] = profile.endTime.split(':').map(Number);
  for (const delta of [0, -1]) {
    const day = new Date(today.getTime() + delta * 86400000);
    if (!profile.days.includes(day.getUTCDay())) continue;
    if (profile.recurrence?.type === 'date_range') {
      const dayKey = day.toISOString().slice(0, 10);
      if (profile.recurrence.startDate && dayKey < new Date(profile.recurrence.startDate).toISOString().slice(0, 10)) continue;
      if (profile.recurrence.endDate && dayKey > new Date(profile.recurrence.endDate).toISOString().slice(0, 10)) continue;
    }
    const start = new Date(day);
    start.setUTCHours(startHour, startMinute);
    const end = new Date(day);
    end.setUTCHours(endHour, endMinute);
    if (profile.endTime <= profile.startTime) end.setUTCDate(end.getUTCDate() + 1);
    const startAt = resolveLocalTime(profile, start);
    const endAt = resolveLocalTime(profile, end);
    if (startAt <= now && now < endAt) return { startAt, endAt };
  }
  return null;
}

module.exports = { activeWindow, isValidTimezone, localDate, resolveLocalTime };
