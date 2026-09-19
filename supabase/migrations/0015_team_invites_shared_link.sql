-- TEAM-004: Shared Invite Link Model
--
-- This migration converts team invites from single-use invitations to
-- reusable shared recruitment links:
--
--   1. Drops accepted_at / accepted_by from team_invites (single-use fields)
--   2. Recreates the pending partial index without accepted_at
--   3. Adds 'player_joined_team' to the notifications type CHECK
--   4. Adds a dedup partial unique index for player_joined_team notifications
--   5. Creates accept_team_invite(...) RPC for atomic membership creation
--
-- Invite state is now derived from:
--   revoked_at != null  → revoked
--   expires_at  <= now() → expired
--   otherwise            → pending
--
-- Historical acceptances are represented by team_memberships rows, never
-- by mutating the invite itself. The same invite URL may be accepted by
-- multiple eligible players while it remains valid.

-- ═══════════════════════════════════════════════════════════════
-- 1. DROP SINGLE-USE FIELDS FROM team_invites
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE team_invites DROP COLUMN IF EXISTS accepted_at;
ALTER TABLE team_invites DROP COLUMN IF EXISTS accepted_by;

-- ═══════════════════════════════════════════════════════════════
-- 2. RECREATE PENDING PARTIAL INDEX
-- ═══════════════════════════════════════════════════════════════
--
-- The original index (0014) filtered on `accepted_at IS NULL`, which no
-- longer exists. PostgreSQL auto-drops the index when the column is
-- dropped; the DROP below is a safety no-op, and the CREATE recreates
-- the index without the accepted_at predicate.

DROP INDEX IF EXISTS team_invites_pending_team_idx;

CREATE INDEX IF NOT EXISTS team_invites_pending_team_idx
  ON team_invites (team_profile_id, expires_at)
  WHERE revoked_at IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. WIDEN NOTIFICATIONS TYPE CHECK
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('application_received', 'application_status_changed', 'message_received', 'player_joined_team'));

-- ═══════════════════════════════════════════════════════════════
-- 4. DEDUP INDEX FOR player_joined_team NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════
--
-- One notification per (user_id, membership_id). The source_id is the
-- team_memberships.id, so repeated acceptance attempts for the same
-- membership can never create duplicate notifications.

CREATE UNIQUE INDEX IF NOT EXISTS notifications_player_joined_team_dedup_idx
  ON notifications (user_id, source_id)
  WHERE type = 'player_joined_team' AND source_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 5. RPC: accept_team_invite
-- ═══════════════════════════════════════════════════════════════
--
-- Atomically creates a team_memberships row for a player accepting a
-- shared invite link. The invite row is locked (FOR UPDATE) to serialize
-- concurrent acceptances. The team_memberships unique index on
-- player_profile_id is the final protection against duplicate memberships.
--
-- Returns:
--   { success: true, created: true, membership_id, team_profile_id, team_user_id, team_name }
--   { success: true, created: false, already_member: true, membership_id, team_profile_id, team_user_id, team_name }
--   { success: false, error: 'INVITE_NOT_FOUND' }
--   { success: false, error: 'INVITE_REVOKED' }
--   { success: false, error: 'INVITE_EXPIRED' }
--   { success: false, error: 'PLAYER_ALREADY_ON_TEAM' }
--   { success: false, error: 'Player profile not found' }
--   { success: false, error: 'Player profile does not belong to the authenticated user' }

CREATE OR REPLACE FUNCTION accept_team_invite(
  p_token_hash TEXT,
  p_player_profile_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func_accept_invite$
DECLARE
  v_invite RECORD;
  v_existing_membership RECORD;
  v_membership_id UUID;
  v_player_user_id UUID;
  v_team_user_id UUID;
  v_team_name TEXT;
BEGIN
  IF p_token_hash IS NULL OR p_player_profile_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing required parameters');
  END IF;

  -- Verify the player profile belongs to the authenticated user.
  SELECT user_id INTO v_player_user_id FROM player_profiles WHERE id = p_player_profile_id;
  IF v_player_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Player profile not found');
  END IF;
  IF v_player_user_id::text != p_user_id::text THEN
    RETURN jsonb_build_object('success', false, 'error', 'Player profile does not belong to the authenticated user');
  END IF;

  -- Lock the invite row to serialize concurrent acceptances.
  SELECT * INTO v_invite FROM team_invites WHERE token_hash = p_token_hash FOR UPDATE;
  IF v_invite IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVITE_NOT_FOUND');
  END IF;

  -- Revoked invites are rejected for everyone.
  IF v_invite.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVITE_REVOKED');
  END IF;

  -- Expired invites are rejected for everyone.
  IF v_invite.expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVITE_EXPIRED');
  END IF;

  -- Resolve the team owner and name for the notification.
  SELECT user_id, team_name INTO v_team_user_id, v_team_name
  FROM team_profiles WHERE id = v_invite.team_profile_id;

  -- Check the player's existing membership (one-team-per-player MVP rule).
  SELECT * INTO v_existing_membership
  FROM team_memberships
  WHERE player_profile_id = p_player_profile_id
  LIMIT 1;

  IF v_existing_membership IS NOT NULL THEN
    IF v_existing_membership.team_profile_id = v_invite.team_profile_id THEN
      -- Already a member of this team: idempotent success, no duplicate.
      RETURN jsonb_build_object(
        'success', true,
        'created', false,
        'already_member', true,
        'membership_id', v_existing_membership.id,
        'team_profile_id', v_invite.team_profile_id,
        'team_user_id', v_team_user_id,
        'team_name', v_team_name
      );
    ELSE
      -- Already a member of a different team: reject, never transfer.
      RETURN jsonb_build_object('success', false, 'error', 'PLAYER_ALREADY_ON_TEAM');
    END IF;
  END IF;

  -- Create the membership.
  INSERT INTO team_memberships (team_profile_id, player_profile_id)
  VALUES (v_invite.team_profile_id, p_player_profile_id)
  RETURNING id INTO v_membership_id;

  RETURN jsonb_build_object(
    'success', true,
    'created', true,
    'membership_id', v_membership_id,
    'team_profile_id', v_invite.team_profile_id,
    'team_user_id', v_team_user_id,
    'team_name', v_team_name
  );
EXCEPTION
  WHEN unique_violation THEN
    -- Concurrent acceptance: another request created the membership first.
    -- PL/pgSQL rolls back variable assignments in the exception block, so
    -- re-fetch the invite and membership to determine the correct result.
    SELECT * INTO v_invite FROM team_invites WHERE token_hash = p_token_hash;
    IF v_invite IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'INVITE_NOT_FOUND');
    END IF;

    SELECT user_id, team_name INTO v_team_user_id, v_team_name
    FROM team_profiles WHERE id = v_invite.team_profile_id;

    SELECT * INTO v_existing_membership
    FROM team_memberships
    WHERE player_profile_id = p_player_profile_id
    LIMIT 1;

    IF v_existing_membership IS NOT NULL THEN
      IF v_existing_membership.team_profile_id = v_invite.team_profile_id THEN
        RETURN jsonb_build_object(
          'success', true,
          'created', false,
          'already_member', true,
          'membership_id', v_existing_membership.id,
          'team_profile_id', v_invite.team_profile_id,
          'team_user_id', v_team_user_id,
          'team_name', v_team_name
        );
      ELSE
        RETURN jsonb_build_object('success', false, 'error', 'PLAYER_ALREADY_ON_TEAM');
      END IF;
    END IF;

    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func_accept_invite$;