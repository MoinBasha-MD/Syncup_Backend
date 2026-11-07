const JobRun = require('../models/JobRun');

/** Record a background job's latest run; never throws into the job. */
const recordJobRun = async (name, status, durationMs, error) => {
  try {
    await JobRun.findOneAndUpdate(
      { name },
      {
        lastRunAt: new Date(),
        lastStatus: status,
        lastError: error ? String(error).slice(0, 500) : null,
        lastDurationMs: durationMs,
      },
      { upsert: true },
    );
  } catch (err) {
    console.error(`⚠️ [JOBS] could not record ${name}:`, err.message);
  }
};

/** Wrap a cron callback so its outcome lands in /system/jobs. */
const withJobRun = (name, fn) => async (...args) => {
  const start = Date.now();
  try {
    const result = await fn(...args);
    await recordJobRun(name, 'success', Date.now() - start);
    return result;
  } catch (error) {
    await recordJobRun(name, 'failure', Date.now() - start, error.message);
    throw error;
  }
};

module.exports = { recordJobRun, withJobRun };
