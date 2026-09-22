-- COMP-006: Competition Drawing & Winner Selection
--
-- Builds directly on COMP-001 (foundation), COMP-002 (management +
-- lifecycle), COMP-003 (join links), COMP-004/005 (participant verification +
-- challenge attempts). It adds the ONE new table the drawing needs:
-- competition_drawings — a permanent, immutable record of ONE drawing and its
-- SINGLE winner.
--
-- Design decisions (kept deliberately simple — this is NOT a raffle engine):
--
--   * A drawing belongs to an event (competition_events.id). The winner is
--     represented through the EXISTING relationships — winner_participant_id
--     (competition_participants.id) and winner_profile_id (profiles.id). No
--     personal information (name/email) is copied into this table; display
--     information is resolved from the referenced relationships when rendered.
--
--   * Eligibility is the EXISTING event-specific participant state created by
--     COMP-004: a participant qualifies when an operator records a passing
--     challenge attempt (competition_participants.status = 'qualified'). The
--     drawing NEVER reconstructs qualification from client-supplied values.
--
--   * Exactly ONE drawing per event. Enforced at the database level with
--     UNIQUE(event_id) so two simultaneous "Start Drawing" requests can never
--     produce two winners. The UI is never the only guard.
--
--   * qualified_participant_count is a SERVER-CALCULATED snapshot of how many
--     qualified participants were eligible at drawing time. It is never
--     trusted from the browser.
--
--   * The winner is selected SERVER-SIDE inside the SECURITY DEFINER RPC
--     start_competition_drawing (ORDER BY random() LIMIT 1 over the qualified
--     set). The browser can never pick, submit, or influence the winner.
--
--   * The drawing is IMMUTABLE: there is no update/delete path. Once created it
--     is the permanent record of the result (rerolls are not supported).
--
-- Out of scope (later tickets): multiple winners, rerolls, weighted entries,
-- tickets, prizes, notifications and public result pages.
--
-- NOTE: this app uses NextAuth (JWT) rather than Supabase Auth, so RLS is
-- defense-in-depth and the server-side supabaseAdmin client (service role)
-- performs the authoritative authorization checks. Service-role credentials
-- are never exposed to the client. The drawing write happens inside a
-- SECURITY DEFINER RPC (single transaction) — not as separate browser requests.

-- ═══════════════════════════════════════════════════════════════
-- 1. COMPETITION DRAWINGS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS competition_drawings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  -- The winning participant. Source of truth for "who won".
  winner_participant_id UUID NOT NULL
    REFERENCES competition_participants(id) ON DELETE CASCADE,
  -- The winning profile (denormalised reference so the winner can be resolved
  -- without re-deriving it from the participant). Never carries personal data.
  winner_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- How many qualified participants were eligible when the drawing ran.
  -- Server-calculated snapshot — never client-supplied.
  qualified_participant_count INTEGER NOT NULL
    CHECK (qualified_participant_count >= 1),
  -- The authorized manager (creator or ambassador) who started the drawing.
  drawn_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. INTEGRITY CONSTRAINTS
-- ═══════════════════════════════════════════════════════════════

-- Exactly one drawing per event. This is the primary guarantee that two
-- simultaneous "Start Drawing" requests cannot both create a drawing — the
-- second insert is rejected with a unique_violation.
CREATE UNIQUE INDEX IF NOT EXISTS competition_drawings_event_id_key
  ON competition_drawings (event_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. ATOMIC DRAWING RPC
-- ═══════════════════════════════════════════════════════════════
--
-- Atomically (one transaction):
--   1. Locks the event row (FOR UPDATE) to serialize concurrent drawings.
--   2. Verifies the requester is the event CREATOR or an assigned AMBASSADOR
--      (competition_ambassadors). Never uses profiles.role.
--   3. Rejects when a drawing already exists (one drawing per event).
--   4. Rejects when the event is not in a drawable state (active | drawing).
--   5. Counts the QUALIFIED participants (status = 'qualified').
--   6. Randomly selects exactly ONE qualified participant (ORDER BY random()).
--   7. Inserts the drawing record (winner + count + initiator).
--   8. Moves the event into the terminal `completed` state.
--
-- The browser can never submit a winner, a qualified participant id, or a
-- count: the RPC takes only the event id and the authenticated profile id.
--
-- Returns:
--   { success: true, drawing_id, winner_participant_id, winner_profile_id,
--     qualified_participant_count, drawn_at, drawn_by_profile_id }
--   { success: false, error: 'Missing required parameters' }
--   { success: false, error: 'EVENT_NOT_FOUND' }
--   { success: false, error: 'UNAUTHORIZED' }
--   { success: false, error: 'DRAWING_ALREADY_EXISTS' }
--   { success: false, error: 'EVENT_NOT_DRAWABLE' }
--   { success: false, error: 'NO_QUALIFIED_PARTICIPANTS' }
--   { success: false, error: SQLERRM }

CREATE OR REPLACE FUNCTION start_competition_drawing(
  p_event_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func_start_competition_drawing$
DECLARE
  v_event RECORD;
  v_is_authorized BOOLEAN := false;
  v_existing_id UUID;
  v_qualified_count INTEGER;
  v_winner RECORD;
  v_drawing_id UUID;
  v_drawn_at TIMESTAMPTZ;
BEGIN
  IF p_event_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing required parameters');
  END IF;

  -- Lock the event row to serialize concurrent drawing requests.
  SELECT id, status, created_by
  INTO v_event
  FROM competition_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'EVENT_NOT_FOUND');
  END IF;

  -- Authorize: the event creator OR an assigned ambassador. Never profiles.role.
  IF v_event.created_by::text = p_user_id::text THEN
    v_is_authorized := true;
  ELSE
    SELECT true INTO v_is_authorized
    FROM competition_ambassadors ca
    WHERE ca.event_id = p_event_id
      AND ca.profile_id::text = p_user_id::text
    LIMIT 1;
    v_is_authorized := COALESCE(v_is_authorized, false);
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  -- One drawing per event.
  SELECT id INTO v_existing_id
  FROM competition_drawings
  WHERE event_id = p_event_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'DRAWING_ALREADY_EXISTS');
  END IF;

  -- Only an active (or already-prepared) event can be drawn.
  IF v_event.status NOT IN ('active', 'drawing') THEN
    RETURN jsonb_build_object('success', false, 'error', 'EVENT_NOT_DRAWABLE');
  END IF;

  -- Server-side eligibility: only qualified participants count.
  SELECT count(*) INTO v_qualified_count
  FROM competition_participants
  WHERE event_id = p_event_id
    AND status = 'qualified';

  IF v_qualified_count IS NULL OR v_qualified_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_QUALIFIED_PARTICIPANTS');
  END IF;

  -- Server-side random selection of exactly ONE qualified participant.
  SELECT id AS participant_id, profile_id
  INTO v_winner
  FROM competition_participants
  WHERE event_id = p_event_id
    AND status = 'qualified'
  ORDER BY random()
  LIMIT 1;

  IF v_winner.participant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_QUALIFIED_PARTICIPANTS');
  END IF;

  INSERT INTO competition_drawings (
    event_id,
    winner_participant_id,
    winner_profile_id,
    qualified_participant_count,
    drawn_by_profile_id
  )
  VALUES (
    p_event_id,
    v_winner.participant_id,
    v_winner.profile_id,
    v_qualified_count,
    p_user_id
  )
  RETURNING id, drawn_at INTO v_drawing_id, v_drawn_at;

  -- The drawing ends the competition.
  UPDATE competition_events
  SET status = 'completed'
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'drawing_id', v_drawing_id,
    'winner_participant_id', v_winner.participant_id,
    'winner_profile_id', v_winner.profile_id,
    'qualified_participant_count', v_qualified_count,
    'drawn_at', v_drawn_at,
    'drawn_by_profile_id', p_user_id
  );
EXCEPTION
  WHEN unique_violation THEN
    -- Concurrent drawing: another request created the drawing first.
    RETURN jsonb_build_object('success', false, 'error', 'DRAWING_ALREADY_EXISTS');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func_start_competition_drawing$;

-- ═══════════════════════════════════════════════════════════════
-- 4. INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS competition_drawings_winner_participant_id_idx
  ON competition_drawings (winner_participant_id);
CREATE INDEX IF NOT EXISTS competition_drawings_winner_profile_id_idx
  ON competition_drawings (winner_profile_id);
CREATE INDEX IF NOT EXISTS competition_drawings_drawn_by_idx
  ON competition_drawings (drawn_by_profile_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════
--
-- Drawings are never publicly writable. Reads are limited to the event
-- creator and the event's ambassadors (the drawing managers). All writes go
-- through the SECURITY DEFINER RPC above, which re-checks authorization.

ALTER TABLE competition_drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Event creator can read drawing"
  ON competition_drawings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_drawings.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

CREATE POLICY "Event ambassador can read drawing"
  ON competition_drawings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_ambassadors ca
      WHERE ca.event_id = competition_drawings.event_id
      AND ca.profile_id::text = auth.uid()::text
    )
  );