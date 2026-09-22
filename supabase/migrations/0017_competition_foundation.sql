-- COMP-001: Competition Foundation & Data Model
--
-- This migration introduces the foundational schema for the Competitions
-- feature. It is intentionally additive and does NOT modify the existing
-- marketplace tables (profiles, player_profiles, team_profiles, ...).
--
-- Core architectural decision:
--
--   Competition participation is built on the EXISTING auth system and the
--   EXISTING `profiles` table ONLY. Participating in a competition must NOT
--   require marketplace onboarding and must NOT create a `player_profiles`
--   (or `team_profiles`) row.
--
--   profiles
--      ├── player_profiles            (marketplace onboarding — untouched)
--      ├── team_profiles              (marketplace onboarding — untouched)
--      └── competition_participants   (competitions — added here)
--
-- Being a competition ambassador is a COMPETITION-SPECIFIC authorization
-- relationship (competition_ambassadors), never a marketplace role. This
-- migration does NOT touch profiles.role.
--
-- Out of scope for COMP-001 (later tickets): challenge_attempts,
-- raffle_entries, winners, tickets, QR tokens, notifications and
-- participant verification.
--
-- NOTE: This app uses NextAuth (JWT) rather than Supabase Auth, so RLS is
-- defense-in-depth and the server-side `supabaseAdmin` client (service
-- role) performs the authoritative authorization checks. Service-role
-- credentials are never exposed to the client.

-- ═══════════════════════════════════════════════════════════════
-- 1. COMPETITION EVENTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS competition_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  -- Event date-time, consistent with every other date-time column here.
  event_date TIMESTAMPTZ,
  -- Lifecycle: draft → active → drawing → completed, or cancelled.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'drawing', 'completed', 'cancelled')),
  -- Challenge configuration lives ON THE EVENT so future competitions can
  -- use different challenges. Application logic must never hard-code
  -- values like 30 / 3.
  --
  -- Example: challenge_name = 'Juggle Challenge',
  --          challenge_threshold = 30, max_attempts = 3
  challenge_name TEXT NOT NULL,
  challenge_threshold INTEGER NOT NULL CHECK (challenge_threshold > 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  -- Authoritative manager/creator. Populated server-side from the
  -- authenticated profile — never trusted from the client.
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. COMPETITION PARTICIPANTS
-- ═══════════════════════════════════════════════════════════════
--
-- A person's participation in a specific competition. References
-- competition_events.id and profiles.id ONLY — it must NEVER require a
-- player_profiles row.
--
-- `qualified` / `not_qualified` are EVENT-SPECIFIC states and live here,
-- never on player_profiles. A player who fails one competition can still
-- take part in another.

CREATE TABLE IF NOT EXISTS competition_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Participant lifecycle for the intended competition flow.
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'challenge_pending', 'qualified', 'not_qualified')),
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 3. COMPETITION AMBASSADORS
-- ═══════════════════════════════════════════════════════════════
--
-- Which authenticated accounts are authorized as ambassadors for a
-- specific competition. This is a competition-specific authorization
-- relationship — it does NOT use profiles.role.
--
-- A user can be a player, a team manager, or an account with no
-- marketplace profile at all and still be an ambassador here if
-- explicitly authorized.

CREATE TABLE IF NOT EXISTS competition_ambassadors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 4. UNIQUENESS CONSTRAINTS (database-enforced, not app-enforced)
-- ═══════════════════════════════════════════════════════════════

-- A profile may register for a given event at most once.
CREATE UNIQUE INDEX IF NOT EXISTS competition_participants_event_profile_key
  ON competition_participants (event_id, profile_id);

-- An account may be an ambassador for a given event at most once.
CREATE UNIQUE INDEX IF NOT EXISTS competition_ambassadors_event_profile_key
  ON competition_ambassadors (event_id, profile_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS competition_events_created_by_idx
  ON competition_events (created_by);
CREATE INDEX IF NOT EXISTS competition_events_status_idx
  ON competition_events (status);
CREATE INDEX IF NOT EXISTS competition_events_event_date_idx
  ON competition_events (event_date);

CREATE INDEX IF NOT EXISTS competition_participants_event_id_idx
  ON competition_participants (event_id);
CREATE INDEX IF NOT EXISTS competition_participants_profile_id_idx
  ON competition_participants (profile_id);
CREATE INDEX IF NOT EXISTS competition_participants_status_idx
  ON competition_participants (status);

CREATE INDEX IF NOT EXISTS competition_ambassadors_event_id_idx
  ON competition_ambassadors (event_id);
CREATE INDEX IF NOT EXISTS competition_ambassadors_profile_id_idx
  ON competition_ambassadors (profile_id);

-- ═══════════════════════════════════════════════════════════════
-- 6. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════
--
-- Competition data must never be publicly writable. The server-side
-- management operations additionally verify ownership/ambassador
-- authorization with the service-role client (see lib/competition-server.ts).

ALTER TABLE competition_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_ambassadors ENABLE ROW LEVEL SECURITY;

-- ─── competition_events ────────────────────────────────────────

-- The event creator can read their events.
CREATE POLICY "Event creator can read own events"
  ON competition_events
  FOR SELECT
  USING (auth.uid()::text = created_by::text);

-- Ambassadors can read the events they are authorized for.
CREATE POLICY "Event ambassador can read event"
  ON competition_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_ambassadors ca
      WHERE ca.event_id = competition_events.id
      AND ca.profile_id::text = auth.uid()::text
    )
  );

-- Only the creator may create an event (created_by must be the caller).
CREATE POLICY "Creator can create events"
  ON competition_events
  FOR INSERT
  WITH CHECK (auth.uid()::text = created_by::text);

-- Only the creator may modify event configuration.
CREATE POLICY "Event creator can update own events"
  ON competition_events
  FOR UPDATE
  USING (auth.uid()::text = created_by::text)
  WITH CHECK (auth.uid()::text = created_by::text);

-- Only the creator may delete an event.
CREATE POLICY "Event creator can delete own events"
  ON competition_events
  FOR DELETE
  USING (auth.uid()::text = created_by::text);

-- ─── competition_participants ──────────────────────────────────

-- A participant can read their own participation.
CREATE POLICY "Participant can read own participation"
  ON competition_participants
  FOR SELECT
  USING (auth.uid()::text = profile_id::text);

-- The event creator can read all participants of their event.
CREATE POLICY "Event creator can read participants"
  ON competition_participants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_participants.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

-- Event ambassadors can read all participants of their event.
CREATE POLICY "Event ambassador can read participants"
  ON competition_participants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_ambassadors ca
      WHERE ca.event_id = competition_participants.event_id
      AND ca.profile_id::text = auth.uid()::text
    )
  );

-- A participant can register (create their own row) for an event.
CREATE POLICY "Participant can self-register"
  ON competition_participants
  FOR INSERT
  WITH CHECK (auth.uid()::text = profile_id::text);

-- The event creator may also add participants.
CREATE POLICY "Event creator can add participants"
  ON competition_participants
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_participants.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

-- Participant status is changed only by the event creator or an event
-- ambassador. Participants must NOT be able to promote themselves to
-- 'qualified' by writing their own row.
CREATE POLICY "Event creator can update participants"
  ON competition_participants
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_participants.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

CREATE POLICY "Event ambassador can update participants"
  ON competition_participants
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM competition_ambassadors ca
      WHERE ca.event_id = competition_participants.event_id
      AND ca.profile_id::text = auth.uid()::text
    )
  );

-- Only the event creator may remove participants.
CREATE POLICY "Event creator can remove participants"
  ON competition_participants
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_participants.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

-- ─── competition_ambassadors ───────────────────────────────────

-- The event creator can read ambassadors.
CREATE POLICY "Event creator can read ambassadors"
  ON competition_ambassadors
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_ambassadors.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

-- An ambassador can read their own association.
CREATE POLICY "Ambassador can read own association"
  ON competition_ambassadors
  FOR SELECT
  USING (auth.uid()::text = profile_id::text);

-- Only the event creator may create ambassador relationships. This
-- prevents arbitrary users from authorizing themselves or others.
CREATE POLICY "Event creator can create ambassadors"
  ON competition_ambassadors
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_ambassadors.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

-- Only the event creator may remove ambassador relationships.
CREATE POLICY "Event creator can delete ambassadors"
  ON competition_ambassadors
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_ambassadors.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 7. TRIGGERS FOR updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE TRIGGER set_competition_events_updated_at
  BEFORE UPDATE ON competition_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_competition_participants_updated_at
  BEFORE UPDATE ON competition_participants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
