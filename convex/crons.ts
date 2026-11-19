import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily at 00:05 UTC (08:05 Asia/Manila): expire trials/subscriptions & reset monthly counters
crons.daily(
  "daily-subscription-expiry-sweep",
  { hourUTC: 0, minuteUTC: 5 },
  internal.cronJobs.sweepSubscriptions
);

// Daily at 16:15 UTC (00:15 Asia/Manila): roll up yesterday's clinic & platform analytics
crons.daily(
  "daily-analytics-rollup",
  { hourUTC: 16, minuteUTC: 15 },
  internal.cronJobs.rollupDailyAnalytics,
  {}
);

// Daily at 01:00 UTC (09:00 Asia/Manila): send 24-hour reminders for tomorrow's visits
crons.daily(
  "daily-24h-appointment-reminders",
  { hourUTC: 1, minuteUTC: 0 },
  internal.cronJobs.dispatch24hReminders
);

// Daily at 01:30 UTC (09:30 Asia/Manila): send 6-month Oral Prophylaxis hygiene recalls
crons.daily(
  "daily-hygiene-recall-check",
  { hourUTC: 1, minuteUTC: 30 },
  internal.cronJobs.dispatchHygieneRecalls
);

// Daily at 17:00 UTC (01:00 Asia/Manila): clean up any orphaned expired slot locks
crons.daily(
  "daily-expired-slot-lock-cleanup",
  { hourUTC: 17, minuteUTC: 0 },
  internal.cronJobs.cleanupExpiredSlotLocks
);

export default crons;
