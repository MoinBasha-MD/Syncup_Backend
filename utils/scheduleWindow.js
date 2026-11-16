/**
 * Evaluate a daily StatusSchedule window in the USER's timezone rather than
 * the server's local timezone. The stored startTime/endTime instants are read
 * as wall-clock times in the user's timezone (the same wall time the user saw
 * on their device when they created the schedule).
 */
const { localDate, resolveLocalTime } = require('./primaryTimeClock');

const minutesOfDayInTimezone = (instant, timezone) => {
  const local = localDate({ timezone }, new Date(instant));
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

/**
 * Returns { endAt: Date } when `now` falls inside the schedule's window for
 * the user's current day in `timezone`, else null.
 * `endAt` is the window's end as an absolute instant (next occurrence boundary).
 */
const activeScheduleWindow = (schedule, timezone, now = new Date()) => {
  const localNow = localDate({ timezone }, now);
  const currentDay = localNow.getUTCDay();
  const currentMinutes = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();

  const daysOfWeek = schedule.recurrenceConfig?.daysOfWeek || [];
  if (!daysOfWeek.includes(currentDay)) return null;

  const startMinutes = minutesOfDayInTimezone(schedule.startTime, timezone);
  const endMinutes = minutesOfDayInTimezone(schedule.endTime, timezone);

  const crossMidnight = endMinutes < startMinutes;
  const isInRange = crossMidnight
    ? currentMinutes >= startMinutes || currentMinutes < endMinutes
    : currentMinutes >= startMinutes && currentMinutes < endMinutes;
  if (!isInRange) return null;

  const today = new Date(Date.UTC(
    localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()));
  const endDay = new Date(today);
  if (crossMidnight && currentMinutes >= startMinutes) {
    // Evening part of a cross-midnight window — it ends tomorrow.
    endDay.setUTCDate(endDay.getUTCDate() + 1);
  }
  const endWall = new Date(endDay);
  endWall.setUTCHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);

  return { endAt: resolveLocalTime({ timezone }, endWall) };
};

module.exports = { activeScheduleWindow, minutesOfDayInTimezone };
