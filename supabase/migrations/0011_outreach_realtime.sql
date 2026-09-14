-- MVP-020/019: Team Outreach + Realtime Fixes
--
-- This migration adds:
-- 1. outreach table (team-initiated contact with players)
-- 2. Conversation schema changes: nullable application_id, add outreach_id
-- 3. RPC: create_outreach_with_initial_message (atomic)
-- 4. Modified RPC: create_application_with_conversation (reuse outreach conversations)
-- 5. RPC: update_outreach_status (accept/decline/withdraw)
-- 6. Updated RLS policies for outreach and conversations

-- ═══════════════════════════════════════════════════════════════
-- 1. CREATE OUTREACH TABLE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS outreach (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  team_profile_id UUID NOT NULL REFERENCES team_profiles(id) ON DELETE CASCADE,
  player_profile_id UUID NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE,
  initial_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  -- Prevent duplicate outreach from the same team to the same player for the same opportunity
  UNIQUE(opportunity_id, team_profile_id, player_profile_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS outreach_opportunity_id_idx ON outreach (opportunity_id);
CREATE INDEX IF NOT EXISTS outreach_team_profile_id_idx ON outreach (team_profile_id);
CREATE INDEX IF NOT EXISTS outreach_player_profile_id_idx ON outreach (player_profile_id);
CREATE INDEX IF NOT EXISTS outreach_status_idx ON outreach (status);

-- ═══════════════════════════════════════════════════════════════
-- 2. MODIFY CONVERSATIONS TABLE
-- ═══════════════════════════════════════════════════════════════

-- Drop the UNIQUE constraint on application_id (default name from column definition)
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_application_id_key;

-- Make application_id nullable
ALTER TABLE conversations ALTER COLUMN application_id DROP NOT NULL;

-- Add outreach_id column
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS outreach_id UUID REFERENCES outreach(id) ON DELETE CASCADE;

-- Ensure at least one relationship is present
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_relationship_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_relationship_check
  CHECK (application_id IS NOT NULL OR outreach_id IS NOT NULL);

-- Partial unique indexes to prevent duplicate conversations per application/outreach
CREATE UNIQUE INDEX IF NOT EXISTS conversations_application_id_unique_idx
  ON conversations (application_id) WHERE application_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_outreach_id_unique_idx
  ON conversations (outreach_id) WHERE outreach_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. ENABLE RLS ON OUTREACH
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE outreach ENABLE ROW LEVEL SECURITY;

-- Team can view their own outreach (they own the team profile)
CREATE POLICY "Team can view own outreach"
  ON outreach
  FOR SELECT
  USING (
    auth.uid()::text = (SELECT user_id::text FROM team_profiles WHERE id = team_profile_id)
  );

-- Team can create outreach for their own opportunities
CREATE POLICY "Team can create own outreach"
  ON outreach
  FOR INSERT
  WITH CHECK (
    auth.uid()::text = (SELECT user_id::text FROM team_profiles WHERE id = team_profile_id)
    AND EXISTS (
      SELECT 1 FROM opportunities o
      WHERE o.id = opportunity_id AND o.team_id = team_profile_id
    )
  );

-- Team can update their own outreach
CREATE POLICY "Team can update own outreach"
  ON outreach
  FOR UPDATE
  USING (
    auth.uid()::text = (SELECT user_id::text FROM team_profiles WHERE id = team_profile_id)
  );

-- Player can view outreach sent to them
CREATE POLICY "Player can view own outreach"
  ON outreach
  FOR SELECT
  USING (
    auth.uid()::text = (SELECT user_id::text FROM player_profiles WHERE id = player_profile_id)
  );

-- Player can update outreach status (accept/decline)
CREATE POLICY "Player can update own outreach"
  ON outreach
  FOR UPDATE
  USING (
    auth.uid()::text = (SELECT user_id::text FROM player_profiles WHERE id = player_profile_id)
  );

-- ═══════════════════════════════════════════════════════════════
-- 4. UPDATE CONVERSATION RLS POLICIES
-- ═══════════════════════════════════════════════════════════════

-- Drop old "System can create conversations" policy (it references application_id only)
DROP POLICY IF EXISTS "System can create conversations" ON conversations;

-- New policy: system or participants can create conversations
CREATE POLICY "System can create conversations"
  ON conversations
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role' OR
    (
      -- Application-based access
      (application_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM applications a
        WHERE a.id = application_id
        AND (
          EXISTS (
            SELECT 1 FROM player_profiles pp
            WHERE pp.id = a.player_profile_id
            AND pp.user_id::text = auth.uid()::text
          )
          OR
          EXISTS (
            SELECT 1 FROM opportunities o
            JOIN team_profiles tp ON tp.id = o.team_id
            WHERE o.id = a.opportunity_id
            AND tp.user_id::text = auth.uid()::text
          )
        )
      ))
      OR
      -- Outreach-based access
      (outreach_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM outreach orx
        WHERE orx.id = outreach_id
        AND (
          EXISTS (
            SELECT 1 FROM player_profiles pp
            WHERE pp.id = orx.player_profile_id
            AND pp.user_id::text = auth.uid()::text
          )
          OR
          EXISTS (
            SELECT 1 FROM team_profiles tp
            WHERE tp.id = orx.team_profile_id
            AND tp.user_id::text = auth.uid()::text
          )
        )
      ))
    )
  );

-- Update message INSERT policy to work with outreach conversations
DROP POLICY IF EXISTS "Users can send messages as themselves" ON messages;

CREATE POLICY "Users can send messages as themselves"
  ON messages
  FOR INSERT
  WITH CHECK (
    sender_id::text = auth.uid()::text
    AND
    EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_id = messages.conversation_id
      AND user_id::text = auth.uid()::text
    )
    AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
      AND (
        c.application_id IS NOT NULL OR c.outreach_id IS NOT NULL
      )
    )
    AND
    char_length(trim(COALESCE(body, ''))) > 0
  );

-- ═══════════════════════════════════════════════════════════════
-- 5. TRIGGER FOR OUTREACH updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE TRIGGER set_outreach_updated_at
  BEFORE UPDATE ON outreach
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════
-- 6. ENABLE REALTIME FOR OUTREACH
-- ═══════════════════════════════════════════════════════════════

DO $realtime$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'outreach'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE outreach;
  END IF;
END;
$realtime$;

-- ═══════════════════════════════════════════════════════════════
-- 7. RPC: create_outreach_with_initial_message
-- ═══════════════════════════════════════════════════════════════
--
-- Atomically creates outreach + (existing-or-new) conversation + participants + initial message.

CREATE OR REPLACE FUNCTION create_outreach_with_initial_message(
  p_opportunity_id UUID,
  p_player_profile_id UUID,
  p_initial_message TEXT,
  p_user_id UUID
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

  SELECT id, user_id INTO v_team_profile_id, v_team_user_id FROM team_profiles WHERE user_id = p_user_id;
  IF v_team_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Team profile not found');
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

-- ═══════════════════════════════════════════════════════════════
-- 8. MODIFIED RPC: create_application_with_conversation
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_application_with_conversation(
  p_opportunity_id UUID,
  p_player_profile_id UUID,
  p_cover_message TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func_apply$
DECLARE
  v_application_id UUID;
  v_conversation_id UUID;
  v_team_user_id UUID;
  v_opportunity_status TEXT;
  v_existing_application_id UUID;
  v_existing_outreach_id UUID;
  v_player_user_id UUID;
  v_opp_team_id UUID;
BEGIN
  IF p_opportunity_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'opportunity_id is required');
  END IF;
  IF p_player_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'player_profile_id is required');
  END IF;

  SELECT user_id INTO v_player_user_id FROM player_profiles WHERE id = p_player_profile_id;
  IF v_player_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Player profile not found');
  END IF;
  IF p_user_id IS NOT NULL AND v_player_user_id::text != p_user_id::text THEN
    RETURN jsonb_build_object('success', false, 'error', 'Player profile does not belong to the authenticated user');
  END IF;

  SELECT o.status, o.team_id INTO v_opportunity_status, v_opp_team_id
  FROM opportunities o WHERE o.id = p_opportunity_id;
  IF v_opportunity_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Opportunity not found');
  END IF;
  IF v_opportunity_status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This opportunity is no longer accepting applications');
  END IF;

  SELECT tp.user_id INTO v_team_user_id FROM team_profiles tp WHERE tp.id = v_opp_team_id;
  IF v_team_user_id IS NOT NULL AND v_player_user_id = v_team_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot apply to your own team''s opportunity');
  END IF;

  SELECT id INTO v_existing_application_id
  FROM applications
  WHERE opportunity_id = p_opportunity_id AND player_profile_id = p_player_profile_id
  LIMIT 1;

  IF v_existing_application_id IS NOT NULL THEN
    SELECT id INTO v_conversation_id FROM conversations WHERE application_id = v_existing_application_id;
    IF v_conversation_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'application_id', v_existing_application_id, 'conversation_id', v_conversation_id, 'already_applied', true);
    END IF;

    SELECT o.id INTO v_existing_outreach_id
    FROM outreach o
    WHERE o.opportunity_id = p_opportunity_id AND o.player_profile_id = p_player_profile_id
    LIMIT 1;
    IF v_existing_outreach_id IS NOT NULL THEN
      SELECT id INTO v_conversation_id FROM conversations WHERE outreach_id = v_existing_outreach_id;
      IF v_conversation_id IS NOT NULL THEN
        UPDATE conversations SET application_id = v_existing_application_id WHERE id = v_conversation_id;
        RETURN jsonb_build_object('success', true, 'application_id', v_existing_application_id, 'conversation_id', v_conversation_id, 'already_applied', true);
      END IF;
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'You have already applied to this opportunity', 'existing_application_id', v_existing_application_id);
  END IF;

  SELECT o.id INTO v_existing_outreach_id
  FROM outreach o
  JOIN team_profiles tp ON tp.id = o.team_profile_id
  WHERE o.opportunity_id = p_opportunity_id AND o.player_profile_id = p_player_profile_id
  LIMIT 1;
  IF v_existing_outreach_id IS NOT NULL THEN
    SELECT id INTO v_conversation_id FROM conversations WHERE outreach_id = v_existing_outreach_id;
  END IF;

  INSERT INTO applications (opportunity_id, player_profile_id, cover_message)
  VALUES (p_opportunity_id, p_player_profile_id, p_cover_message)
  RETURNING id INTO v_application_id;

  IF v_conversation_id IS NOT NULL THEN
    UPDATE conversations SET application_id = v_application_id WHERE id = v_conversation_id;
    RETURN jsonb_build_object('success', true, 'application_id', v_application_id, 'conversation_id', v_conversation_id);
  END IF;

  INSERT INTO conversations (application_id) VALUES (v_application_id) RETURNING id INTO v_conversation_id;
  INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_conversation_id, v_player_user_id);
  INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_conversation_id, v_team_user_id);

  RETURN jsonb_build_object('success', true, 'application_id', v_application_id, 'conversation_id', v_conversation_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func_apply$;

-- ═══════════════════════════════════════════════════════════════
-- 9. RPC: update_outreach_status
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_outreach_status(
  p_outreach_id UUID,
  p_new_status TEXT,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func_outreach_status$
DECLARE
  v_outreach RECORD;
  v_valid_statuses TEXT[] := ARRAY['pending', 'accepted', 'declined', 'withdrawn'];
  v_player_user_id UUID;
  v_team_user_id UUID;
BEGIN
  IF p_outreach_id IS NULL OR p_new_status IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing required parameters');
  END IF;
  IF NOT p_new_status = ANY(v_valid_statuses) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid outreach status');
  END IF;

  SELECT * INTO v_outreach FROM outreach WHERE id = p_outreach_id;
  IF v_outreach IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Outreach not found');
  END IF;

  SELECT user_id INTO v_player_user_id FROM player_profiles WHERE id = v_outreach.player_profile_id;
  SELECT user_id INTO v_team_user_id FROM team_profiles WHERE id = v_outreach.team_profile_id;

  IF v_player_user_id = p_user_id THEN
    IF v_outreach.status != 'pending' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Outreach is no longer pending');
    END IF;
    IF p_new_status NOT IN ('accepted', 'declined') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Players can only accept or decline outreach');
    END IF;
  ELSIF v_team_user_id = p_user_id THEN
    IF v_outreach.status != 'pending' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Outreach is no longer pending');
    END IF;
    IF p_new_status != 'withdrawn' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Teams can only withdraw outreach');
    END IF;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE outreach SET status = p_new_status WHERE id = p_outreach_id;
  RETURN jsonb_build_object('success', true, 'outreach_id', p_outreach_id, 'status', p_new_status);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func_outreach_status$;
