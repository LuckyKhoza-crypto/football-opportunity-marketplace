-- COMP-004: Participant Verification & Challenge Attempt Tracking
--
-- Builds directly on COMP-001 (foundation) and COMP-003 (join links +
-- participant verification fields). It adds the ONE new table the on-site
-- challenge flow needs: competition_attempts — one row per physical challenge
-- attempt recorded by an authorized event operator.
--
-- Design decisions:
--
--   * An attempt belongs to BOTH an event (competition_events.id) and a
--     participant (competition_participants.id). The participant already
--     carries the private verification credential created in COMP-003
--     (verification_code / verification_token_hash) — no second participant
--     identity system is introduced here.
--
--   * The attempt result is intentionally GENERIC (NUMERIC). The schema does
--     not hard-code soccer/juggle/seconds units — a challenge could later be
--     speed, distance, repetitions, score or time. The comparison direction is
--     application logic (see lib/competition-attempt.ts), not schema.
--
--   * attempt_number is server-assigned and unique per participant. The
--     database also enforces it with UNIQUE(participant_id, attempt_number) so
--     a race can never record attempt #N twice.
--
--   * Max-attempt enforcement is enforced in BOTH the server helper and (as
--     defence-in-depth) a BEFORE INSERT trigger, so even a direct write cannot
--     exceed the event's configured max_attempts.
--
-- Out of scope (later tickets): raffle entries, drawing, winners, prizes,
-- notifications and competition completion.
--
-- NOTE: this app uses NextAuth (JWT) rather than Supabase Auth, so RLS is
-- defense-in-depth and the server-side supabaseAdmin client (service role)
-- performs the authoritative authorization checks. The service-role
-- credentials are never exposed to the client.

-- ═══════════════════════════════════════════════════════════════
-- 1. COMPETITION ATTEMPTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS competition_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL
    REFERENCES competition_participants(id) ON DELETE CASCADE,
  -- Server-assigned, 1-based, contiguous per participant. Never trusted from
  -- the browser.
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  -- Generic numeric challenge result (no unit baked into the schema).
  result_value NUMERIC NOT NULL,
  -- Determined SERVER-SIDE by comparing result_value against the event's
  -- configured challenge_threshold. The browser can never set this.
  passed BOOLEAN NOT NULL DEFAULT false,
  -- The authorized operator (event creator) who recorded the attempt.
  recorded_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. INTEGRITY CONSTRAINTS
-- ═══════════════════════════════════════════════════════════════

-- A participant may have multiple attempts, but never two with the same
-- attempt number. This is the primary concurrency guarantee: two racing
-- requests that compute the same next attempt number cannot both succeed.
CREATE UNIQUE INDEX IF NOT EXISTS competition_attempts_participant_attempt_key
  ON competition_attempts (participant_id, attempt_number);

-- ═══════════════════════════════════════════════════════════════
-- 3. DEFENCE-IN-DEPTH TRIGGER (event ownership + max attempts)
-- ═══════════════════════════════════════════════════════════════
--
-- The server helper performs these checks too, but enforcing them at the
-- database level means a bug (or a direct write) can never:
--   * attach an attempt to a participant of a DIFFERENT event,
--   * exceed the event's configured max_attempts.

CREATE OR REPLACE FUNCTION enforce_competition_attempt_integrity()
RETURNS TRIGGER AS $$
DECLARE
  v_participant_event_id UUID;
  v_max_attempts INTEGER;
BEGIN
  SELECT event_id INTO v_participant_event_id
  FROM competition_participants
  WHERE id = NEW.participant_id;

  IF v_participant_event_id IS NULL THEN
    RAISE EXCEPTION 'competition_participant_not_found';
  END IF;

  IF v_participant_event_id <> NEW.event_id THEN
    RAISE EXCEPTION 'competition_participant_event_mismatch';
  END IF;

  SELECT max_attempts INTO v_max_attempts
  FROM competition_events
  WHERE id = NEW.event_id;

  IF v_max_attempts IS NULL THEN
    RAISE EXCEPTION 'competition_event_not_found';
  END IF;

  IF NEW.attempt_number > v_max_attempts THEN
    RAISE EXCEPTION 'competition_max_attempts_exceeded';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_competition_attempt_integrity_trigger
  BEFORE INSERT ON competition_attempts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_competition_attempt_integrity();

-- ═══════════════════════════════════════════════════════════════
-- 4. INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS competition_attempts_event_id_idx
  ON competition_attempts (event_id);
CREATE INDEX IF NOT EXISTS competition_attempts_participant_id_idx
  ON competition_attempts (participant_id);
CREATE INDEX IF NOT EXISTS competition_attempts_recorded_by_idx
  ON competition_attempts (recorded_by_profile_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════
--
-- Attempts must never be publicly writable. Reads are limited to the event
-- creator and the owning participant; all writes go through the service-role
-- server helpers which re-check authorization.

ALTER TABLE competition_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Event creator can read attempts"
  ON competition_attempts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_attempts.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

CREATE POLICY "Participant can read own attempts"
  ON competition_attempts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_participants cp
      WHERE cp.id = competition_attempts.participant_id
      AND cp.profile_id::text = auth.uid()::text
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 6. TRIGGER FOR updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE TRIGGER set_competition_attempts_updated_at
  BEFORE UPDATE ON competition_attempts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();