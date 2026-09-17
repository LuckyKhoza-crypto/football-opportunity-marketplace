-- MVP: Multiple Team Profiles Per User
--
-- This migration:
-- 1. Drops the UNIQUE constraint on team_profiles.user_id
--    (allows one user to own multiple team profiles)
-- 2. Preserves the existing foreign key and index
-- 3. Updates create_outreach_with_initial_message RPC to accept
--    a specific team_profile_id and verify ownership

-- ═══════════════════════════════════════════════════════════════
-- 1. DROP UNIQUE CONSTRAINT ON team_profiles.user_id
-- ═══════════════════════════════════════════════════════════════

-- The UNIQUE constraint was created inline in CREATE TABLE:
--   user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE
-- PostgreSQL auto-named it: team_profiles_user_id_key
ALTER TABLE team_profiles DROP CONSTRAINT IF EXISTS team_profiles_user_id_key;

-- The existing index team_profiles_user_id_idx (from migration 00004)
-- remains in place for fast lookups by user_id.

-- ═══════════════════════════════════════════════════════════════
-- 2. UPDATE RPC: create_outreach_with_initial_message
-- ═══════════════════════════════════════════════════════════════
--
-- The old version selected a team by user_id only:
--   SELECT id, user_id FROM team_profiles WHERE user_id = p_user_id
--
-- This assumed one team per user. The new version accepts an
-- explicit p_team_profile_id and verifies that the team belongs
-- to the authenticated user.

CREATE OR REPLACE FUNCTION create_outreach_with_initial_message(
  p_opportunity_id UUID,
  p_player_profile_id UUID,
  p_initial_message TEXT,
  p_user_id UUID,
  p_team_profile_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func_outreach$
DECLARE
  v_team_profile_id UUID;
  v_team_user_id UUID;
  v_opportunity_team_id UUID;
  v_player_user_id UUID;
  v_existing_outreach_id UUID;
  v_existing_application_id UUID;
  v_conversation_id UUID;
  v_message_id UUID;
  v_message_text TEXT;
BEGIN
  IF p_opportunity_id IS NULL OR p_player_profile_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing required parameters');
  END IF;

  v_message_text := trim(COALESCE(p_initial_message, ''));
  IF char_length(v_message_text) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Initial message is required');
  END IF;
  IF char_length(v_message_text) > 5000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Message cannot exceed 5000 characters');
  END IF;

  SELECT user_id INTO v_player_user_id FROM player_profiles WHERE id = p_player_profile_id;
  IF v_player_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Player profile not found');
  END IF;

  -- Resolve the team profile: use the explicit team_profile_id if provided,
  -- otherwise fall back to the user's first team (backward compatibility).
  IF p_team_profile_id IS NOT NULL THEN
    SELECT id, user_id INTO v_team_profile_id, v_team_user_id
    FROM team_profiles
    WHERE id = p_team_profile_id AND user_id = p_user_id;
  ELSE
    SELECT id, user_id INTO v_team_profile_id, v_team_user_id
    FROM team_profiles
    WHERE user_id = p_user_id
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_team_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Team profile not found or access denied');
  END IF;

  SELECT team_id INTO v_opportunity_team_id FROM opportunities WHERE id = p_opportunity_id;
  IF v_opportunity_team_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Opportunity not found');
  END IF;
  IF v_opportunity_team_id != v_team_profile_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Opportunity does not belong to this team');
  END IF;

  IF v_player_user_id = p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot contact your own player profile');
  END IF;

  SELECT id INTO v_existing_outreach_id
  FROM outreach
  WHERE opportunity_id = p_opportunity_id
    AND team_profile_id = v_team_profile_id
    AND player_profile_id = p_player_profile_id
  LIMIT 1;

  SELECT id INTO v_existing_application_id
  FROM applications
  WHERE opportunity_id = p_opportunity_id
    AND player_profile_id = p_player_profile_id
  LIMIT 1;

  IF v_existing_application_id IS NOT NULL THEN
    SELECT id INTO v_conversation_id FROM conversations WHERE application_id = v_existing_application_id;
  END IF;
  IF v_conversation_id IS NULL AND v_existing_outreach_id IS NOT NULL THEN
    SELECT id INTO v_conversation_id FROM conversations WHERE outreach_id = v_existing_outreach_id;
  END IF;

  IF v_existing_outreach_id IS NULL THEN
    INSERT INTO outreach (opportunity_id, team_profile_id, player_profile_id, initial_message)
    VALUES (p_opportunity_id, v_team_profile_id, p_player_profile_id, v_message_text)
    RETURNING id INTO v_existing_outreach_id;
  END IF;

  IF v_conversation_id IS NULL THEN
    INSERT INTO conversations (application_id, outreach_id)
    VALUES (v_existing_application_id, v_existing_outreach_id)
    RETURNING id INTO v_conversation_id;

    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conversation_id, v_player_user_id);
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conversation_id, v_team_user_id);
  ELSE
    UPDATE conversations SET outreach_id = COALESCE(outreach_id, v_existing_outreach_id)
    WHERE id = v_conversation_id;
  END IF;

  INSERT INTO messages (conversation_id, sender_id, body)
  VALUES (v_conversation_id, p_user_id, v_message_text)
  RETURNING id INTO v_message_id;

  RETURN jsonb_build_object(
    'success', true,
    'outreach_id', v_existing_outreach_id,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func_outreach$;