-- A coach's read of a finished session, stored on the session itself.
--
-- Generated once per set of logged sets (`review_fingerprint`). Opening the session
-- again shows the stored read instead of spending another model call, and a changed
-- set — an edit after finish — no longer matches, so the next open reads it again.
alter table workout_sessions
  add column if not exists review jsonb,
  add column if not exists review_fingerprint text;
