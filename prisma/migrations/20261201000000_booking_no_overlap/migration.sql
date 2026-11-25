-- Database-level guard against double booking.
-- The booking service already checks availability inside a transaction while holding a lock on the
-- provider row; this constraint is the last line of defense if any code path ever skips that check.
--
-- Two active bookings (PENDING or CONFIRMED) of the same provider can never overlap in time.
-- Ranges are half-open [start, end), so back-to-back bookings (10:00-11:00 and 11:00-12:00) are allowed.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    "providerId" WITH =,
    tsrange("startsAt", "endsAt") WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED'));
