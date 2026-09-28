-- TOURN-001: External Tournament Provider Mapping (FOM <-> Challonge)
--
-- Integrates an EXTERNAL tournament engine (Challonge v1 today, others later)
-- with the EXISTING competition system. It is intentionally additive: no
-- existing table, column, policy or RPC is modified, and no tournament-engine
-- state is copied into Supabase.
--
-- Core architectural decision — the provider stays the source of truth for
-- bracket structure, match progression, match state, scores, standings and
-- advancement. FOM stays the source of truth for users, profiles, competition
-- registration, permissions and FOM metadata. Only the IDENTIFIERS needed to
-- connect the two systems are stored here:
--
--   competition_events
--     provider                 -- which provider holds the tournament ("challonge")
--     provider_tournament_id   -- the provider's own tournament id
--
--   competition_participants
--     provider_participant_id  -- the provider's own participant id
--
-- There is deliberately NO table for matches, rounds, brackets, standings or
-- results: duplicating the provider's engine would create two sources of truth
-- and require a synchronisation worker, which is out of scope.
--
-- `provider` is free-form text (not an enum/CHECK list) so a future provider
-- can be added without another migration. The provider id is chosen by the
-- server-side provider registry (lib/integrations/tournament/registry.ts).
--
-- Out of scope (later tickets): tournament API routes, bracket UI, registration
-- UI changes, webhooks, polling workers, notifications and standings.
--
-- NOTE: this app uses NextAuth (JWT) rather than Supabase Auth, so RLS is
-- defense-in-depth and the server-side supabaseAdmin client (service role)
-- performs the authoritative authorization checks. These columns reuse the
-- EXISTING row policies: they are never written from the browser, only by the
-- server-side tournament service after `canManageEvent` is re-checked.

-- ═══════════════════════════════════════════════════════════════
-- 1. COMPETITION -> PROVIDER TOURNAMENT MAPPING
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE competition_events
  ADD COLUMN IF NOT EXISTS provider TEXT;

ALTER TABLE competition_events
  ADD COLUMN IF NOT EXISTS provider_tournament_id TEXT;

-- A competition either has an external tournament or it does not: the two
-- columns are set together by the tournament service. A half-written mapping
-- (provider without an id, or an id with no provider) can therefore never
-- exist, which keeps "is this competition linked?" a single unambiguous check.
ALTER TABLE competition_events
  ADD CONSTRAINT competition_events_provider_pair_check
  CHECK ((provider IS NULL) = (provider_tournament_id IS NULL));

-- ═══════════════════════════════════════════════════════════════
-- 2. PARTICIPANT -> PROVIDER PARTICIPANT MAPPING
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE competition_participants
  ADD COLUMN IF NOT EXISTS provider_participant_id TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 3. UNIQUENESS CONSTRAINTS (database-enforced, not app-enforced)
-- ═══════════════════════════════════════════════════════════════

-- One external tournament may be linked to at most one competition. This is the
-- database-level guarantee that a provider tournament can never be adopted by
-- two different FOM competitions.
CREATE UNIQUE INDEX IF NOT EXISTS competition_events_provider_tournament_key
  ON competition_events (provider, provider_tournament_id)
  WHERE provider_tournament_id IS NOT NULL;

-- Within an event, a provider participant id may be mapped at most once — two
-- FOM participants can never claim the same bracket entry.
CREATE UNIQUE INDEX IF NOT EXISTS competition_participants_provider_participant_key
  ON competition_participants (event_id, provider_participant_id)
  WHERE provider_participant_id IS NOT NULL;
