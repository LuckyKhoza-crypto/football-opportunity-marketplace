-- T-REM-3: Competition-specific participant bans + atomic host removal
--
-- Builds on T-REM-1 (`competition_participants.removed_at` soft-removal, 0026)
-- and T-REM-2 (player self-unregistration). It adds the ONE new table a
-- COMPETITION-SPECIFIC ban needs, plus ONE atomic RPC so a host "ban" and the
-- accompanying removal of an active registration can never half-apply.
--
-- Why a new table (and not a column on competition_participants)?
--
--   competition_participants has UNIQUE(event_id, profile_id) — exactly one row
--   per (event, player). A future re-registration ticket will have to redesign
--   that constraint. A ban must OUTLIVE that change and must be truthful even
--   when no active registration exists, so it is stored as its own durable row
--   keyed by (event_id, profile_id):
--
--     competition_bans
--       event_id             -- the competition the ban applies to
--       profile_id           -- the banned player (profiles.id)
--       banned_at            -- when the ban was recorded
--       banned_by_profile_id -- the authorized manager who banned them
--       reason               -- optional, free-form operator note
--
--   The ban is COMPETITION-SPECIFIC — it is never a global account ban and it
--   never expires when a participant is removed. The registration service checks
--   it (server-side) before creating ANY new registration.
--
-- Removal vs banning stays a clear separation:
--   * REMOVE  → soft-removes an eligible registration; the player may register
--               again later (subject to the competition's registration rules).
--   * BAN     → records a durable competition-specific ban AND (if the player is
--               still actively registered) removes that registration using the
--               SAME eligibility rule as T-REM-2. If that removal is unsafe
--               (already checked in, has attempts, or is synced to the external
--               tournament) the whole operation is refused — nothing is written,
--               so there is never a misleading partial result.
--
-- NOTE: this app uses NextAuth (JWT) rather than Supabase Auth, so RLS is
-- defense-in-depth and the server-side supabaseAdmin client (service role)
-- performs the authoritative authorization checks. Ban rows are never written
-- from the browser: all writes go through the SECURITY DEFINER RPC below, which
-- re-checks `canManageEvent`-equivalent authorization in the database too.

-- ═══════════════════════════════════════════════════════════════
-- 1. COMPETITION BANS (durable, competition-specific)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS competition_bans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The competition the ban applies to. Deleting the competition removes its
  -- bans (they are meaningless without it).
  event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  -- The banned player. References the EXISTING auth profile (profiles.id),
  -- never player_profiles — the same identity competitions already use.
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- When the ban was recorded. Defaulted so it is always a durable timestamp.
  banned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The authorized manager (creator or ambassador) who recorded the ban.
  -- ON DELETE SET NULL keeps the ban itself even if the acting profile is later
  -- deleted — a ban is history and must not vanish with an unrelated deletion.
  banned_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Free-form operator note. Optional and never a closed set.
  reason TEXT,
  -- One ban per (competition, player). This is the database-level guarantee that
  -- a duplicate/concurrent ban request can never create two rows, and it is what
  -- the atomic RPC's ON CONFLICT clause targets.
  CONSTRAINT competition_bans_event_profile_key UNIQUE (event_id, profile_id)
);

-- ═══════════════════════════════════════════════════════════════
-- 2. INDEXES
-- ═══════════════════════════════════════════════════════════════
--
-- The UNIQUE(event_id, profile_id) constraint already provides the composite
-- index the ban lookups use (by event, and by event + player). The two foreign
-- key columns that are NOT the leading column of that index are indexed
-- explicitly (mirroring competition_drawings): `profile_id` supports the
-- ON DELETE CASCADE from profiles and any player-scoped ban lookup, and
-- `banned_by_profile_id` supports the manager FK.

CREATE INDEX IF NOT EXISTS competition_bans_profile_id_idx
  ON competition_bans (profile_id);

CREATE INDEX IF NOT EXISTS competition_bans_banned_by_profile_id_idx
  ON competition_bans (banned_by_profile_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. ROW LEVEL SECURITY (defense-in-depth; writes only via the RPC)
-- ═══════════════════════════════════════════════════════════════
--
-- Bans are never publicly readable (a public competition view must not expose
-- ban-management state). Reads are limited to the event creator and the event's
-- ambassadors. There are deliberately NO insert/update/delete policies: all
-- writes go through the SECURITY DEFINER RPC below / the service role.

ALTER TABLE competition_bans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Event creator can read bans"
  ON competition_bans
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_bans.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

CREATE POLICY "Event ambassador can read bans"
  ON competition_bans
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_ambassadors ca
      WHERE ca.event_id = competition_bans.event_id
      AND ca.profile_id::text = auth.uid()::text
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 4. ATOMIC REMOVE / BAN RPC
-- ═══════════════════════════════════════════════════════════════
--
-- One SECURITY DEFINER function performs the whole host operation in a single
-- transaction:
--
--   p_ban = false → REMOVE an eligible active registration (soft). A player who
--                   is already removed is reported back (already_removed=true)
--                   so the API can answer a duplicate request predictably.
--   p_ban = true  → record the durable ban AND, when the player is still
--                   actively registered, soft-remove that registration using the
--                   SAME lifecycle rule. If the registration cannot be safely
--                   removed (checked in / has attempts / provider-synced / event
--                   not active) the function returns an error BEFORE writing
--                   anything — the ban is NOT created and the caller sees no
--                   partial result. A ban on an already-removed player is always
--                   allowed.
--
-- Concurrency: the participant row is locked FOR UPDATE, so two concurrent
-- remove/ban requests (or a concurrent check-in / provider sync) are serialized.
-- The ban INSERT uses ON CONFLICT DO NOTHING against the unique (event_id,
-- profile_id) key, and duplicate ban requests are reported idempotently.
--
-- Returns (jsonb):
--   { success: true, participant_id, profile_id, removed, already_removed,
--     removed_at, banned, already_banned, banned_at }
--   { success: false, error: 'MISSING_PARAMS' | 'UNAUTHORIZED'
--       | 'PARTICIPANT_NOT_FOUND' | 'CANNOT_TARGET_SELF' | 'EVENT_NOT_ACTIVE'
--       | 'PARTICIPANT_CHECKED_IN' | 'PARTICIPANT_HAS_ATTEMPTS'
--       | 'PARTICIPANT_PROVIDER_MAPPED' | 'PARTICIPANT_STATE_CHANGED' | SQLERRM }

CREATE OR REPLACE FUNCTION remove_competition_participant(
  p_event_id UUID,
  p_participant_id UUID,
  p_actor_profile_id UUID,
  p_removal_reason TEXT,
  p_ban BOOLEAN DEFAULT false,
  p_ban_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func_remove_competition_participant$
DECLARE
  v_participant competition_participants%ROWTYPE;
  v_authorized BOOLEAN;
  v_event_status TEXT;
  v_attempt_count INTEGER;
  v_removed_at TIMESTAMPTZ;
  v_removed BOOLEAN := false;
  v_already_removed BOOLEAN := false;
  v_ban_id UUID;
  v_banned_at TIMESTAMPTZ;
  v_already_banned BOOLEAN := false;
BEGIN
  IF p_event_id IS NULL OR p_participant_id IS NULL OR p_actor_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_PARAMS');
  END IF;

  -- Defense-in-depth authorization: the acting profile must be the event
  -- creator OR an assigned ambassador. The API also re-checks this in TS via
  -- canManageEvent, so authorization never depends on a single layer.
  SELECT (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = p_event_id
        AND ce.created_by = p_actor_profile_id
    )
    OR EXISTS (
      SELECT 1 FROM competition_ambassadors ca
      WHERE ca.event_id = p_event_id
        AND ca.profile_id = p_actor_profile_id
    )
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  -- Lock the participant row so concurrent remove/ban/check-in/provider-sync
  -- requests on the same participant are serialized.
  SELECT * INTO v_participant
  FROM competition_participants
  WHERE id = p_participant_id
    AND event_id = p_event_id
  FOR UPDATE;

  -- The participant MUST belong to the specified event. A missing row (or a
  -- participant of another event) is indistinguishable — never leaks which.
  IF v_participant.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PARTICIPANT_NOT_FOUND');
  END IF;

  -- An operator can never remove or ban themselves through this action.
  IF v_participant.profile_id = p_actor_profile_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'CANNOT_TARGET_SELF');
  END IF;

  IF v_participant.removed_at IS NOT NULL THEN
    -- Already removed: no registration change is needed. The ban (if requested)
    -- is still recorded — a previously removed player remains ban-able.
    v_already_removed := true;
    v_removed_at := v_participant.removed_at;
  ELSE
    -- Removal/re-registration changes the registration, so the SAME lifecycle
    -- rule as T-REM-2 (player self-unregistration) applies.
    SELECT status INTO v_event_status
    FROM competition_events
    WHERE id = p_event_id;

    IF v_event_status IS DISTINCT FROM 'active' THEN
      RETURN jsonb_build_object('success', false, 'error', 'EVENT_NOT_ACTIVE');
    END IF;

    IF v_participant.checked_in_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PARTICIPANT_CHECKED_IN');
    END IF;

    -- Provider synchronization is not reversible here: silently claiming a
    -- player was removed from an external bracket would be wrong, so the whole
    -- operation is refused when they are already mapped.
    IF v_participant.provider_participant_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PARTICIPANT_PROVIDER_MAPPED');
    END IF;

    SELECT count(*) INTO v_attempt_count
    FROM competition_attempts
    WHERE event_id = p_event_id
      AND participant_id = v_participant.id;

    IF v_attempt_count > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'PARTICIPANT_HAS_ATTEMPTS');
    END IF;

    -- Soft removal: the row (and all history) is preserved. The conditional
    -- WHERE re-checks eligibility so a state change cannot slip past the lock.
    UPDATE competition_participants
    SET removed_at = now(),
        removed_by_profile_id = p_actor_profile_id,
        removal_reason = NULLIF(p_removal_reason, '')
    WHERE id = v_participant.id
      AND removed_at IS NULL
      AND checked_in_at IS NULL
      AND provider_participant_id IS NULL
    RETURNING removed_at INTO v_removed_at;

    IF v_removed_at IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'PARTICIPANT_STATE_CHANGED');
    END IF;

    v_removed := true;
  END IF;

  IF p_ban THEN
    INSERT INTO competition_bans (event_id, profile_id, banned_by_profile_id, reason)
    VALUES (
      p_event_id,
      v_participant.profile_id,
      p_actor_profile_id,
      NULLIF(p_ban_reason, '')
    )
    ON CONFLICT (event_id, profile_id) DO NOTHING
    RETURNING id, banned_at INTO v_ban_id, v_banned_at;

    IF v_ban_id IS NULL THEN
      -- A ban already existed; return the existing record (idempotent).
      v_already_banned := true;
      SELECT id, banned_at INTO v_ban_id, v_banned_at
      FROM competition_bans
      WHERE event_id = p_event_id
        AND profile_id = v_participant.profile_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'participant_id', v_participant.id,
    'profile_id', v_participant.profile_id,
    'removed', v_removed,
    'already_removed', v_already_removed,
    'removed_at', v_removed_at,
    'banned', p_ban,
    'already_banned', v_already_banned,
    'banned_at', v_banned_at
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func_remove_competition_participant$;

