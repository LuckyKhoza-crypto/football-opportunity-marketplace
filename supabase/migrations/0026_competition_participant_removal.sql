-- T-REM-1: Competition Participant Soft-Removal Foundation
--
-- Database foundation for SAFELY removing a participant from a FOM-Sports
-- competition WITHOUT deleting any historical data. This migration is
-- intentionally additive: it only adds NULLABLE columns to the existing
-- `competition_participants` table. No row is deleted, rewritten or backfilled,
-- and no existing uniqueness constraint, foreign key, RLS policy, grant,
-- trigger or Realtime configuration is changed.
--
-- Core decision — soft removal, never a hard delete:
--
--   A participant row is the anchor for historical data:
--     competition_attempts        (participant_id FK)
--     competition_drawings        (winner_participant_id FK)
--     check-in / verification     (checked_in_at and verification history)
--     provider_participant_id      (external tournament mapping)
--     notifications                (source_id = participant id)
--
--   Deleting the row would cascade into / orphan that history. Instead, removal
--   is recorded on the SAME row:
--
--     removed_at IS NULL      -> the participant is ACTIVE
--     removed_at IS NOT NULL  -> the participant has been REMOVED (soft)
--
--   That single rule lives in `lib/competition.ts` (`isActiveParticipant`) so
--   participant lists, tournament eligibility and email recipient selection can
--   reuse it in later tickets. This migration does NOT filter any existing query.
--
-- Deliberately NOT added here:
--   * a new participant registration value — a nullable removal timestamp is
--     sufficient and keeps the existing participant lifecycle intact;
--   * a new index — see the note in section 2.
--
-- NOTE: this app uses NextAuth (JWT) rather than Supabase Auth, so RLS is
-- defense-in-depth and the server-side supabaseAdmin client (service role)
-- performs the authoritative authorization checks. The new columns reuse the
-- EXISTING `competition_participants` row policies and are never written from
-- the browser.

-- ═══════════════════════════════════════════════════════════════
-- 1. SOFT-REMOVAL COLUMNS (additive, nullable)
-- ═══════════════════════════════════════════════════════════════

-- When the participant was removed. NULL for every existing and new row, so
-- existing registrations remain ACTIVE by default with no backfill.
ALTER TABLE competition_participants
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

-- Who performed the removal. ON DELETE SET NULL keeps the removal fact even if
-- the acting profile is later deleted: the participant's removal is history and
-- must not be silently reverted by an unrelated profile deletion. This mirrors
-- the existing `profiles` foreign-key convention.
ALTER TABLE competition_participants
  ADD COLUMN IF NOT EXISTS removed_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Free-form operator note. Optional and never closed-set (no constraint): the
-- reason is operational context, not a modelled state.
ALTER TABLE competition_participants
  ADD COLUMN IF NOT EXISTS removal_reason TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 2. INDEXES
-- ═══════════════════════════════════════════════════════════════
--
-- No index is added. Active-participant queries (`WHERE event_id = ? AND
-- removed_at IS NULL`) are ALREADY served by the existing
-- `competition_participants_event_id_idx` (and by the leading column of the
-- UNIQUE `competition_participants_event_profile_key`), so another event_id
-- index would be redundant. Soft removal is expected to be rare, so a partial
-- `... WHERE removed_at IS NULL` index would be near-identical in size to the
-- plain index while adding write cost, for no meaningful benefit.
