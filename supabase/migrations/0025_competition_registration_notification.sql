-- COMP-EMAIL-001: Competition registration confirmation notification type
--
-- The competition registration confirmation email reuses the existing
-- `notifications` layer as its DEDUPLICATION GATE and in-app record:
--
--   competition registration (pass token mint)
--     -> createNotification('competition_registration_confirmed')
--     -> (deduped) -> best-effort confirmation email with the EXACT pass QR
--
-- A new notification type cannot be inserted without widening the
-- `notifications.type` CHECK constraint (00010 / 0015). This migration is
-- therefore the minimum schema change required; everything else (outbox,
-- dedup, retry) is reused unchanged.
--
-- Design notes:
--   * This type is intentionally NOT email-enabled in
--     `lib/email/notification-delivery.ts`. The confirmation email embeds a
--     sensitive per-participant verification token that must NOT be persisted
--     in `notifications.data` (or any column) just so the durable outbox could
--     rebuild it. The email is instead built in memory from the exact pass
--     token and sent best-effort. Only the notification row (a dedup marker +
--     in-app record) is persisted.
--   * `source_id` is the `competition_participants.id`, so repeated pass-token
--     mints / retries for the same registration can never create a second
--     notification (and therefore never a second confirmation email).
--
-- Nothing else changes: RLS, policies, Realtime publication and the existing
-- per-type dedup indexes are untouched.

-- ═══════════════════════════════════════════════════════════════
-- 1. WIDEN NOTIFICATIONS TYPE CHECK
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'application_received',
    'application_status_changed',
    'message_received',
    'player_joined_team',
    'competition_registration_confirmed'
  ));

-- ═══════════════════════════════════════════════════════════════
-- 2. DEDUP INDEX FOR competition_registration_confirmed NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════
--
-- One notification per (user_id, participant_id). `source_id` is the
-- competition_participants.id, so repeated mints / retries for the same
-- registration cannot create duplicate notifications (mirrors the existing
-- application_received / message_received / player_joined_team indexes).

CREATE UNIQUE INDEX IF NOT EXISTS notifications_competition_registration_dedup_idx
  ON notifications (user_id, source_id)
  WHERE type = 'competition_registration_confirmed' AND source_id IS NOT NULL;
