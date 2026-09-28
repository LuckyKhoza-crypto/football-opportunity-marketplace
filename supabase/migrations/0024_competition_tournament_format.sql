-- TOURN-002A: Configurable tournament format (FOM <-> provider configuration)
--
-- TOURN-001/002 could only ever create ONE format (single elimination), so the
-- format was never stored: the provider's bracket was the only record of it.
-- TOURN-002A makes the format an explicit organiser choice, so FOM needs to
-- remember which format a competition's external tournament was created with.
--
-- This migration is intentionally additive and stores CONFIGURATION only:
--
--   competition_events
--     tournament_format   -- the FOM format the tournament was created with
--
-- Challonge (or any future provider) remains the source of truth for the
-- bracket: no matches, rounds, standings, seeds or results are stored here, and
-- no provider request/response shape is stored either. The value is FOM's own
-- vocabulary (lib/integrations/tournament/types.ts), never a provider's.
--
-- The provider columns added by 0023 are untouched, and the format is written
-- together with them by the tournament service, in the same conditional UPDATE.
--
-- NOTE: this app uses NextAuth (JWT) rather than Supabase Auth, so RLS is
-- defense-in-depth and the server-side supabaseAdmin client (service role)
-- performs the authoritative authorization checks. This column reuses the
-- EXISTING row policies: it is never written from the browser, only by the
-- server-side tournament service after `canManageEvent` is re-checked.

-- ═══════════════════════════════════════════════════════════════
-- 1. TOURNAMENT CONFIGURATION
-- ═══════════════════════════════════════════════════════════════

-- NULL means "no format recorded": a competition without an external
-- tournament, or a row written before this migration. There is deliberately NO
-- column DEFAULT — a default would also apply to competitions that have no
-- tournament at all, and would claim a format for a tournament that do not
-- exist. Rows that ARE linked are backfilled below.
ALTER TABLE competition_events
  ADD COLUMN IF NOT EXISTS tournament_format TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 2. BACKFILL EXISTING TOURNAMENTS (backward compatibility)
-- ═══════════════════════════════════════════════════════════════

-- Every tournament created before TOURN-002A was created as single elimination:
-- that was the only format the integration could create. Recording it keeps
-- existing linked competitions working exactly as before.
UPDATE competition_events
  SET tournament_format = 'single_elimination'
  WHERE provider_tournament_id IS NOT NULL
    AND tournament_format IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. CONSTRAINTS (database-enforced, not app-enforced)
-- ═══════════════════════════════════════════════════════════════

-- The stored value must be a format FOM models. This is a DATA-INTEGRITY guard,
-- NOT the list of formats that can be created: whether a format can actually be
-- created is a capability of the configured provider adapter
-- (TournamentProvider.supportsFormat), evaluated at creation time. Unsupported
-- formats are therefore never mapped onto a supported one — they are refused.
ALTER TABLE competition_events
  ADD CONSTRAINT competition_events_tournament_format_check
  CHECK (
    tournament_format IS NULL
    OR tournament_format IN (
      'single_elimination',
      'double_elimination',
      'round_robin',
      'swiss',
      'group_stage_knockout'
    )
  );

-- A competition that has an external tournament always records the format it
-- was created with, and a competition without one records no format. Together
-- with 0023's provider pair CHECK, an external tournament's configured format
-- can never be missing or orphaned.
ALTER TABLE competition_events
  ADD CONSTRAINT competition_events_tournament_format_pair_check
  CHECK ((tournament_format IS NULL) = (provider_tournament_id IS NULL));
