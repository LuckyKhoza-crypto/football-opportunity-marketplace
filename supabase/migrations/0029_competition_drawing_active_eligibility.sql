-- T-REM-4 (remainder): drawing eligibility must exclude soft-removed participants
--
-- Problem
-- -------
-- `start_competition_drawing` (migration 0020) selects its winner with:
--
--     WHERE event_id = p_event_id AND status = 'qualified'
--
-- Since T-REM-1/T-REM-4 a participant can be soft-removed
-- (`competition_participants.removed_at IS NOT NULL`) and every ACTIVE
-- operational query in the app filters such rows out — but the authoritative
-- database-side winner selection did not. The application-side pre-check
-- (`getQualifiedParticipantCount`, which does filter `removed_at IS NULL`) made
-- this unreachable through the UI, but the database operation itself must
-- enforce the rule: the RPC is SECURITY DEFINER and the single source of truth
-- for who can win, so authorization/eligibility must never depend on an
-- application pre-check.
--
-- Fix (strictly additive)
-- -----------------------
-- This migration ONLY replaces the function body with `removed_at IS NULL`
-- added to BOTH the eligibility count and the winner selection. Everything else
-- is preserved exactly:
--
--   * the same signature `(p_event_id UUID, p_user_id UUID) RETURNS JSONB`,
--   * the same SECURITY DEFINER + `SET search_path = public`,
--   * the same event row lock (`FOR UPDATE`) that serializes concurrent drawings,
--   * the same creator-OR-ambassador authorization (competition_ambassadors),
--   * the same one-drawing-per-event rejection and drawable-status check,
--   * the same `ORDER BY random() LIMIT 1` selection, INSIDE the same
--     single transaction,
--   * the same `qualified_participant_count` snapshot semantics (now counting
--     only eligible, i.e. active, qualified participants),
--   * the same error codes and `NO_QUALIFIED_PARTICIPANTS` outcome when no
--     active qualified participant remains,
--   * the same unique_violation handling for a concurrent drawing.
--
-- Historical data is untouched: this migration reads `removed_at` and writes
-- nothing except through the RPC's existing path. It never updates or deletes
-- `competition_drawings`, `competition_attempts` or any existing participant
-- row, and it does not change the drawing table, its RLS or its indexes.
--
-- Consequence (intended): a previously drawn winner stays recorded even if that
-- participant is later removed — the change applies to NEW drawings only.

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

  -- Server-side eligibility: only ACTIVE qualified participants count.
  -- T-REM-4: `removed_at IS NULL` excludes soft-removed participants, matching
  -- the app-side `isActiveParticipant` rule and `getQualifiedParticipantCount`.
  SELECT count(*) INTO v_qualified_count
  FROM competition_participants
  WHERE event_id = p_event_id
    AND status = 'qualified'
    AND removed_at IS NULL;

  IF v_qualified_count IS NULL OR v_qualified_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_QUALIFIED_PARTICIPANTS');
  END IF;

  -- Server-side random selection of exactly ONE active qualified participant.
  SELECT id AS participant_id, profile_id
  INTO v_winner
  FROM competition_participants
  WHERE event_id = p_event_id
    AND status = 'qualified'
    AND removed_at IS NULL
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

