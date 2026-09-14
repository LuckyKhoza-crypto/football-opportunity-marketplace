-- MVP-019: Real-Time Messaging System
--
-- This migration adds:
-- 1. conversations table (one per application)
-- 2. conversation_participants table (exactly two per conversation)
-- 3. messages table (the actual messages)
-- 4. RLS policies for all tables
-- 5. Database function for atomic application + conversation creation
-- 6. Indexes for query performance
-- 7. Backfill for existing applications that lack conversations

-- ═══════════════════════════════════════════════════════════════
-- 1. CREATE ALL TABLES FIRST (no RLS yet, to avoid dependency issues)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 5000),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS conversations_application_id_idx ON conversations (application_id);
CREATE INDEX IF NOT EXISTS conversation_participants_conversation_id_idx ON conversation_participants (conversation_id);
CREATE INDEX IF NOT EXISTS conversation_participants_user_id_idx ON conversation_participants (user_id);
CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS messages_conversation_id_created_at_idx ON messages (conversation_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 3. ENABLE RLS ON ALL TABLES
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- 4. RLS POLICIES — CONVERSATIONS
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "Users can view conversations they participate in"
  ON conversations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_id = conversations.id
      AND user_id::text = auth.uid()::text
    )
  );

CREATE POLICY "System can create conversations"
  ON conversations
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role' OR
    EXISTS (
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
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 5. RLS POLICIES — CONVERSATION PARTICIPANTS
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "Users can view participants in own conversations"
  ON conversation_participants
  FOR SELECT
  USING (
    user_id::text = auth.uid()::text
    OR
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = conversation_participants.conversation_id
      AND cp.user_id::text = auth.uid()::text
    )
  );

CREATE POLICY "Users can update own read state"
  ON conversation_participants
  FOR UPDATE
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "System can add participants"
  ON conversation_participants
  FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role' OR
    user_id::text = auth.uid()::text
  );

-- ═══════════════════════════════════════════════════════════════
-- 6. RLS POLICIES — MESSAGES
-- ═══════════════════════════════════════════════════════════════

CREATE POLICY "Users can read messages in own conversations"
  ON messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_id = messages.conversation_id
      AND user_id::text = auth.uid()::text
    )
  );

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
      AND EXISTS (
        SELECT 1 FROM applications a
        WHERE a.id = c.application_id
      )
    )
    AND
    char_length(trim(COALESCE(body, ''))) > 0
  );

-- No UPDATE or DELETE policies for messages in MVP
-- Messages are permanent

-- ═══════════════════════════════════════════════════════════════
-- 7. TRIGGERS FOR updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════
-- 8. ENABLE REALTIME FOR MESSAGES
-- ═══════════════════════════════════════════════════════════════

DO $realtime$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END;
$realtime$;

-- ═══════════════════════════════════════════════════════════════
-- 9. RPC FUNCTION: create_application_with_conversation
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
AS $func1$
DECLARE
  v_application_id UUID;
  v_conversation_id UUID;
  v_team_user_id UUID;
  v_opportunity_team_id UUID;
  v_opportunity_status TEXT;
  v_existing_application_id UUID;
  v_roles TEXT[];
  v_player_user_id UUID;
BEGIN
  IF p_opportunity_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'opportunity_id is required');
  END IF;
  IF p_player_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'player_profile_id is required');
  END IF;

  SELECT user_id INTO v_player_user_id
  FROM player_profiles WHERE id = p_player_profile_id;
  IF v_player_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Player profile not found');
  END IF;
  IF p_user_id IS NOT NULL AND v_player_user_id::text != p_user_id::text THEN
    RETURN jsonb_build_object('success', false, 'error', 'Player profile does not belong to the authenticated user');
  END IF;

  SELECT o.status, o.team_id INTO v_opportunity_status, v_opportunity_team_id
  FROM opportunities o WHERE o.id = p_opportunity_id;
  IF v_opportunity_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Opportunity not found');
  END IF;
  IF v_opportunity_status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This opportunity is no longer accepting applications');
  END IF;

  SELECT tp.user_id INTO v_team_user_id
  FROM team_profiles tp WHERE tp.id = v_opportunity_team_id;
  IF v_team_user_id IS NOT NULL AND v_player_user_id = v_team_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot apply to your own team''s opportunity');
  END IF;

  SELECT id INTO v_existing_application_id
  FROM applications
  WHERE opportunity_id = p_opportunity_id AND player_profile_id = p_player_profile_id
  LIMIT 1;
  IF v_existing_application_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You have already applied to this opportunity', 'existing_application_id', v_existing_application_id);
  END IF;

  INSERT INTO applications (opportunity_id, player_profile_id, cover_message)
  VALUES (p_opportunity_id, p_player_profile_id, p_cover_message)
  RETURNING id INTO v_application_id;

  INSERT INTO conversations (application_id)
  VALUES (v_application_id)
  RETURNING id INTO v_conversation_id;

  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_conversation_id, v_player_user_id);

  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_conversation_id, v_team_user_id);

  RETURN jsonb_build_object('success', true, 'application_id', v_application_id, 'conversation_id', v_conversation_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func1$;

-- ═══════════════════════════════════════════════════════════════
-- 10. RPC FUNCTION: ensure_conversation_for_application
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ensure_conversation_for_application(
  p_application_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func2$
DECLARE
  v_conversation_id UUID;
  v_opportunity_id UUID;
  v_player_profile_id UUID;
  v_player_user_id UUID;
  v_team_user_id UUID;
  v_opportunity_team_id UUID;
BEGIN
  SELECT id INTO v_conversation_id
  FROM conversations WHERE application_id = p_application_id;
  IF v_conversation_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'conversation_id', v_conversation_id, 'already_existed', true);
  END IF;

  SELECT a.opportunity_id, a.player_profile_id
  INTO v_opportunity_id, v_player_profile_id
  FROM applications a WHERE a.id = p_application_id;
  IF v_opportunity_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Application not found');
  END IF;

  SELECT user_id INTO v_player_user_id FROM player_profiles WHERE id = v_player_profile_id;
  SELECT o.team_id INTO v_opportunity_team_id FROM opportunities o WHERE o.id = v_opportunity_id;
  SELECT tp.user_id INTO v_team_user_id FROM team_profiles tp WHERE tp.id = v_opportunity_team_id;

  INSERT INTO conversations (application_id) VALUES (p_application_id) RETURNING id INTO v_conversation_id;
  INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_conversation_id, v_player_user_id);
  INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_conversation_id, v_team_user_id);

  RETURN jsonb_build_object('success', true, 'conversation_id', v_conversation_id, 'already_existed', false);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func2$;

-- ═══════════════════════════════════════════════════════════════
-- 11. RPC FUNCTION: get_or_create_conversation_for_application
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_or_create_conversation_for_application(
  p_application_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func3$
DECLARE
  v_conversation_id UUID;
  v_application_opportunity_id UUID;
  v_application_player_profile_id UUID;
  v_player_user_id UUID;
  v_team_user_id UUID;
  v_opportunity_team_id UUID;
BEGIN
  SELECT id INTO v_conversation_id
  FROM conversations WHERE application_id = p_application_id;
  IF v_conversation_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'conversation_id', v_conversation_id);
  END IF;

  SELECT a.opportunity_id, a.player_profile_id
  INTO v_application_opportunity_id, v_application_player_profile_id
  FROM applications a WHERE a.id = p_application_id;
  IF v_application_opportunity_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Application not found');
  END IF;

  SELECT user_id INTO v_player_user_id FROM player_profiles WHERE id = v_application_player_profile_id;
  SELECT o.team_id INTO v_opportunity_team_id FROM opportunities o WHERE o.id = v_application_opportunity_id;
  SELECT tp.user_id INTO v_team_user_id FROM team_profiles tp WHERE tp.id = v_opportunity_team_id;

  INSERT INTO conversations (application_id) VALUES (p_application_id) RETURNING id INTO v_conversation_id;
  INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_conversation_id, v_player_user_id);
  INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_conversation_id, v_team_user_id);

  RETURN jsonb_build_object('success', true, 'conversation_id', v_conversation_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$func3$;

-- ═══════════════════════════════════════════════════════════════
-- 12. RPC FUNCTION: get_conversation_unread_count
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_conversation_unread_count(
  p_user_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func4$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM messages m
  JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
  WHERE cp.user_id = p_user_id
    AND m.created_at > cp.last_read_at
    AND m.sender_id != p_user_id;
  RETURN COALESCE(v_count, 0);
END;
$func4$;

-- ═══════════════════════════════════════════════════════════════
-- 13. BACKFILL: Create conversations for existing applications
-- ═══════════════════════════════════════════════════════════════

DO $backfill$
DECLARE
  app_record RECORD;
  v_conversation_id UUID;
  v_player_user_id UUID;
  v_team_user_id UUID;
  v_opportunity_team_id UUID;
  v_count INTEGER := 0;
BEGIN
  FOR app_record IN
    SELECT a.id, a.opportunity_id, a.player_profile_id
    FROM applications a
    LEFT JOIN conversations c ON c.application_id = a.id
    WHERE c.id IS NULL
  LOOP
    SELECT user_id INTO v_player_user_id FROM player_profiles WHERE id = app_record.player_profile_id;
    SELECT o.team_id INTO v_opportunity_team_id FROM opportunities o WHERE o.id = app_record.opportunity_id;
    SELECT tp.user_id INTO v_team_user_id FROM team_profiles tp WHERE tp.id = v_opportunity_team_id;

    INSERT INTO conversations (application_id) VALUES (app_record.id) RETURNING id INTO v_conversation_id;
    INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_conversation_id, v_player_user_id);
    INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_conversation_id, v_team_user_id);
    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 THEN
    RAISE NOTICE 'Backfilled % existing application(s) with conversations', v_count;
  END IF;
END;
$backfill$;