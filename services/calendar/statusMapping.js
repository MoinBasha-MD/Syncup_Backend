/**
 * Pure rules that map a calendar/email event onto the app's status vocabulary
 * (the free-text statuses used across SyncupTab / ScheduleStatus). Keep this
 * DB-free so it stays unit-testable.
 */

const RULES = [
  { status: 'Watching a movie', keywords: ['movie', 'cinema', 'film', 'screening', 'pvr', 'inox', 'bookmyshow', 'imax'] },
  { status: 'Live concert', keywords: ['concert', 'gig', 'live music', 'music festival', 'standup show', 'stand-up'] },
  { status: 'At theatre', keywords: ['theatre', 'theater', 'play ', 'musical', 'opera', 'drama show'] },
  { status: 'On a flight', keywords: ['flight', 'airline', 'boarding pass', 'pnr', 'departure gate'] },
  { status: 'Boarding train', keywords: ['train', 'railway', 'irctc', 'rail '] },
  { status: 'At a hotel', keywords: ['hotel', 'check-in', 'check in', 'resort', 'lodging', 'airbnb'] },
  { status: 'In a meeting', keywords: ['meeting', 'call', 'conference', 'standup', 'sync', 'review', 'interview', 'webinar', 'zoom', 'meet:', 'catch up', 'catchup', '1:1', 'one-on-one'] },
  { status: 'Doctor appointment', keywords: ['doctor', 'dentist', 'clinic', 'hospital', 'medical', 'appointment', 'checkup', 'therapy'] },
  { status: 'At gym', keywords: ['gym', 'workout', 'yoga', 'fitness', 'training session', 'exercise'] },
  { status: 'Playing sports', keywords: ['cricket', 'football', 'badminton', 'tennis', 'basketball', 'match ', 'sports', 'turf'] },
  { status: 'Dining out', keywords: ['lunch', 'dinner', 'breakfast', 'brunch', 'restaurant', 'reservation', 'table for', 'cafe'] },
  { status: 'In class', keywords: ['class', 'lecture', 'course', 'workshop', 'seminar', 'exam'] },
  { status: 'Commuting', keywords: ['commute', 'cab', 'drive to', 'pickup', 'uber', 'ola '] },
  { status: 'Traveling', keywords: ['travel', 'trip', 'vacation', 'journey', 'bus to', 'outstation'] },
  { status: 'Do not disturb', keywords: ['do not disturb', 'dnd', 'focus time', 'deep work', 'no meetings'] },
  { status: 'At home', keywords: ['home', 'family time', 'personal', 'off day', 'leave', 'holiday'] },
  { status: 'At office', keywords: ['office', 'work from office', 'wfo', 'shift'] },
];

const matches = (haystack, keywords) => keywords.some(keyword => haystack.includes(keyword));

/**
 * @param {{title?: string, location?: string, description?: string}} event
 * @returns {{status: string, customStatus: string}} — always returns 'Busy'
 *          with the event title as customStatus when nothing matches.
 */
const mapEventToStatus = (event = {}) => {
  const title = (event.title || '').trim();
  const haystack = `${title} ${event.location || ''} ${event.description || ''}`.toLowerCase();
  for (const rule of RULES) {
    if (matches(haystack, rule.keywords)) {
      return { status: rule.status, customStatus: title || rule.status };
    }
  }
  return { status: 'Busy', customStatus: title || 'Busy' };
};

module.exports = { mapEventToStatus, STATUS_RULES: RULES };
