-- EMAIL-003: Typed notification metadata (data payload)
--
-- Outreach-originated `message_received` notifications need a reliable,
-- explicit way to be distinguished from ordinary conversation messages so the
-- email layer can build a "team contacted you" email instead of generic
-- notification copy.
--
-- Before this migration the only fields available were title/body/link/source_id.
-- Inferring "this is outreach" from message text or sender name would be a
-- fragile heuristic, so we add a small, explicit payload instead.
--
-- `data` is a nullable JSONB blob carrying ONLY non-sensitive, email-safe
-- presentation metadata (team name, opportunity title/role, player name, a
-- discriminator `kind`). It must never contain internal identifiers, secrets,
-- or recipient email addresses.
--
-- This migration adds:
--   1. notifications.data JSONB (nullable)
--   2. a CHECK constraint so any present payload is a JSON object
--
-- Nothing else changes: RLS, policies, dedup indexes, and the Realtime
-- publication are untouched. The column is server-written (service role) and
-- safe to return to the owning client.

-- ═══════════════════════════════════════════════════════════════
-- 1. ADD data COLUMN
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS data JSONB;

-- ═══════════════════════════════════════════════════════════════
-- 2. GUARD: data, when present, must be a JSON object
-- ═══════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_data_is_object'
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_data_is_object
      CHECK (data IS NULL OR jsonb_typeof(data) = 'object');
  END IF;
END;
$guard$;