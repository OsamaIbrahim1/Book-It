export const BOOKINGS_QUEUE = 'bookings';

export const JOB_EXPIRE = 'expire-booking';
export const JOB_REMINDER = 'send-reminder';
export const JOB_SWEEP = 'sweep-expired';

// How long an unpaid (PENDING) booking holds its slot.
// 30 minutes is also the shortest expiry Stripe Checkout allows (used in week 3B).
export const HOLD_MINUTES = 30;

export const REMINDER_HOURS_BEFORE = 24;
export const MAX_DAYS_AHEAD = 90;
