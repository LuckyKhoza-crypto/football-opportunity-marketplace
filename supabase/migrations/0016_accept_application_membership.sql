-- TEAM-005: Accepted Application → Team Membership
--
-- This migration adds the atomic RPC that transitions an application to
-- 'accepted' AND creates/updates the player's team membership in a single
-- database transaction.
--
-- Relationship:
--
--   application
--       ↓
--   opportunity
--       ↓
--   team_profile
--       ↓
--   player_profile
--       ↓
--   team_membership
--
-- The OPPORTUNITY is the authoritative source for team, position, and role.
-- Client-provided team/position/role values are never trusted.
--
-- The membership stores position/role at acceptance time so later edits to
-- the opportunity do not change the player's accepted roster assignment.

-- ═══════════════════════════════════════════════════════════════
-- RPC: accept_application
-- ═══════════════════════════════════════════════════════════════
--
-- Atomically:
--   1. Locks the application row (FOR UPDATE) to serialize concurrent
--      acceptance of the same application.
--   2. Resolves opportunity.team_id, opportunity.position, opportunity.role
--      (authoritative source — never client-provided values).
--   3. Verifies p_user_id owns the team via team_profiles.user_id
--      (multi-team safe: resolves the SPECIFIC team, never the selected
--      team context).
--   4. Rejects ineligible applications (rejected/withdrawn → accepted is
--      not allowed; already-accepted is idempotent success).
--   5. Checks the player's existing membership:
--        - Same team   → UPDATE position/role from the opportunity
--                        (no duplicate membership row).
--        - Other team  → PLAYER_ALREADY_ON_TEAM (never transfer).
--   6. Otherwise INSERTs the membership, then sets application → accepted.
--
-- The team_memberships unique index on player_profile_id is the final
-- protection against duplicate memberships under concurrency.
--
-- Returns:
--   { success: true, created: true, membership_id, team_profile_id, player_profile_id, position, role, already_accepted: false }
--   { success: true, created: false, already_member: true, membership_id, team_profile_id, player_profile_id, position, role, already_accepted: false }
--   { success: true, created: false, already_accepted: true, membership_id, team_profile_id, player_profile_id, position, role }
--   { success: false, error: 'Missing required parameters' }
--   { success: false, error: 'APPLICATION_NOT_FOUND' }
--   { success: false, error: 'UNAUTHORIZED' }
--   { success: false, error: 'APPLICATION_NOT_ELIGIBLE' }
--   { success: false, error: 'PLAYER_ALREADY_ON_TEAM' }
--   { success: false, error: SQLERRM }
--
-- Locking strategy:
--   The application row is locked FOR UPDATE. This serializes concurrent
--   acceptance requests for the same application: the second request blocks
--   until the first commits, then sees status='accepted' and returns
--   idempotent success. The team_memberships unique index on
--   player_profile_id is the final protection for invite+application races
--   and different-team races.
--
-- Authorization assumptions:
--   SECURITY DEFINER with search_path = public. The RPC verifies that
--   p_user_id owns the team that owns the opportunity. It does NOT trust
--   any client-provided team_id, selected team context, or URL parameter.
--
-- Error handling:
--   unique_violation is caught and re-resolved to the correct idempotent
--   or conflict result. All other errors return SQLERRM (the API layer
--   maps these to user-safe messages and never exposes raw DB details).

CREATE OR REPLACE FUNCTION accept_application(
  p_application_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func_accept_application$
DECLARE
  v_application RECORD;
  v_opportunity RECORD;
  v_team_user_id UUID;
  v_existing_membership RECORD;
  v_membership_id UUID;
  v_position TEXT;
  v_role TEXT;
BEGIN
  IF p_application_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing required parameters');
  END IF;

  -- Lock the application row to serialize concurrent acceptance requests.
  SELECT a.id, a.opportunity_id, a.player_profile_id, a.status
  INTO v_application
  FROM applications a
  WHERE a.id = p_application_id
  FOR UPDATE;

  IF v_application.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'APPLICATION_NOT_FOUND');
  END IF;

  -- Resolve the opportunity (authoritative source for team/position/role).
  SELECT o.id, o.team_id, o.position, o.role
  INTO v_opportunity
  FROM opportunities o
  WHERE o.id = v_application.opportunity_id;

  IF v_opportunity.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'APPLICATION_NOT_FOUND');
  END IF;

  -- Verify the authenticated user owns the team that owns the opportunity.
  -- Multi-team safe: resolves the SPECIFIC team_profile_id, never the
  -- manager's selected team context.
  SELECT tp.user_id INTO v_team_user_id
  FROM team_profiles tp
  WHERE tp.id = v_opportunity.team_id;

  IF v_team_user_id IS NULL OR v_team_user_id::text != p_user_id::text THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  -- Idempotent: already accepted → no duplicate membership, no duplicate
  -- notification (the API layer checks already_accepted).
  IF v_application.status = 'accepted' THEN
    SELECT id, team_profile_id, player_profile_id, position, role
    INTO v_existing_membership
    FROM team_memberships
    WHERE player_profile_id = v_application.player_profile_id
    LIMIT 1;

    IF v_existing_membership.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'created', false,
        'already_accepted', true,
        'membership_id', v_existing_membership.id,
        'team_profile_id', v_existing_membership.team_profile_id,
        'player_profile_id', v_existing_membership.player_profile_id,
        'position', v_existing_membership.position,
        'role', v_existing_membership.role
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'created', false,
      'already_accepted', true,
      'membership_id', NULL,
      'team_profile_id', v_opportunity.team_id,
      'player_profile_id', v_application.player_profile_id,
      'position', v_opportunity.position,
      'role', v_opportunity.role
    );
  END IF;

  -- Only pending/reviewing applications are eligible for acceptance.
  IF v_application.status NOT IN ('pending', 'reviewing') THEN
    RETURN jsonb_build_object('success', false, 'error', 'APPLICATION_NOT_ELIGIBLE');
  END IF;

  -- Capture the opportunity's position/role at acceptance time.
  v_position := v_opportunity.position;
  v_role := v_opportunity.role;

  -- Check the player's existing membership (one-team-per-player MVP rule).
  SELECT * INTO v_existing_membership
  FROM team_memberships
  WHERE player_profile_id = v_application.player_profile_id
  LIMIT 1;

  IF v_existing_membership.id IS NOT NULL THEN
    IF v_existing_membership.team_profile_id = v_opportunity.team_id THEN
      -- Already a member of this team (e.g. joined via invite).
      -- The acceptance represents a specific roster assignment, so the
      -- membership's position/role are updated from the opportunity.
      -- joined_at is preserved. No duplicate membership is created.
      UPDATE team_memberships
      SET position = v_position,
          role = v_role
      WHERE id = v_existing_membership.id
      RETURNING id INTO v_membership_id;

      -- Mark the application accepted.
      UPDATE applications
      SET status = 'accepted'
      WHERE id = p_application_id;

      RETURN jsonb_build_object(
        'success', true,
        'created', false,
        'already_member', true,
        'membership_id', v_membership_id,
        'team_profile_id', v_opportunity.team_id,
        'player_profile_id', v_application.player_profile_id,
        'position', v_position,
        'role', v_role,
        'already_accepted', false
      );
    ELSE
      -- Already a member of a different team: reject, never transfer.
      RETURN jsonb_build_object('success', false, 'error', 'PLAYER_ALREADY_ON_TEAM');
    END IF;
  END IF;

  -- Create the membership.
  INSERT INTO team_memberships (team_profile_id, player_profile_id, position, role)
  VALUES (v_opportunity.team_id, v_application.player_profile_id, v_position, v_role)
  RETURNING id INTO v_membership_id;

  -- Mark the application accepted.
  UPDATE applications
  SET status = 'accepted'
  WHERE id = p_application_id;

  RETURN jsonb_build_object(
    'success', true,
    'created', true,
    'membership_id', v_membership_id,
    'team_profile_id', v_opportunity.team_id,
    'player_profile_id', v_application.player_profile_id,
    'position', v_position,
    'role', v_role,
    'already_accepted', false
  );
EXCEPTION
  WHEN unique_violation THEN
    -- Concurrent acceptance: another request created the membership first.
    -- PL/pgSQL rolls back variable assignments in the exception block, so
    -- re-fetch the application and membership to determine the correct result.
    SELECT a.id, a.opportunity_id, a.player_profile_id, a.status
    INTO v_application
    FROM applications a
    WHERE a.id = p_application_id;

    IF v_application.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'APPLICATION_NOT_FOUND');
    END IF;

    SELECT o.id, o.team_id, o.position, o.role
    INTO v_opportunity
    FROM opportunities o
    WHERE o.id = v_application.opportunity_id;

    SELECT * INTO v_existing_membership
    FROM team_memberships
    WHERE player_profile_id = v_application.player_profile_id
    LIMIT 1;

    IF v_existing_membership.id IS NOT NULL THEN
      IF v_existing_membership.team_profile_id = v_opportunity.team_id THEN
        RETURN jsonb_build_object(
          'success', true,
          'created', false,
          'already_member', true,
          'membership_id', v_existing_membership.id,
          'team_profile_id', v_opportunity.team_id,
          'player_profile_id', v_application.player_profile_id,
          'position', v_existing_membership.position,
          'role', v_existing_membership.role,
          'already_accepted', v_application.status = 'accepted'
        );
      ELSE
        RETURN jsonb_build_object('success', false, 'error', 'PLAYER_ALREADY_ON_TEAM');
      END IF;
    END IF;

    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func_accept_application$;