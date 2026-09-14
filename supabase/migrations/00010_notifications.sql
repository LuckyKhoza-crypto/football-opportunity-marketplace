-- MVP-020: Basic In-App Notifications
--
-- This migration adds:
-- 1. notifications table
-- 2. RLS policies (SELECT/UPDATE only — no client INSERT/DELETE)
-- 3. Partial unique indexes for deduplication
-- 4. Realtime publication for notifications
--
-- Notification types for MVP:
--   application_received
--   application_status_changed
--   message_received

-- ═══════════════════════════════════════════════════════════════
-- 1. CREATE NOTIFICATIONS TABLE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notifications (`
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('application_received', 'application_status_changed', 'message_received')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  -- Logical source identifier for deduplication.
  -- For message_received: the message id.
  -- For application_received: the application id.
  -- For application_status_changed: null (status can change multiple times).
  source_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications (user_id);
CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_id_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. DEDUPLICATION (partial unique indexes)
-- ═══════════════════════════════════════════════════════════════
--
-- A notification should correspond to a successfully persisted message.
-- Realtime reconnects, UI refreshes, API retries, or duplicate frontend
-- requests must not create multiple notifications for the same message.
--
-- The same applies to application_received notifications: a player can
-- only apply once (enforced by the applications UNIQUE constraint), so
-- only one notification per application should ever exist.
--
-- application_status_changed notifications intentionally have NO unique
-- constraint because an application's status can change multiple times.

CREATE UNIQUE INDEX IF NOT EXISTS notifications_message_dedup_idx
  ON notifications (user_id, source_id)
  WHERE type = 'message_received' AND source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_application_dedup_idx
  ON notifications (user_id, source_id)
  WHERE type = 'application_received' AND source_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 4. ENABLE RLS
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only read their own notifications
CREATE POLICY "Users can read own notifications"
  ON notifications
  FOR SELECT
  USING (user_id::text = auth.uid()::text);

-- Users can only update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON notifications
  FOR UPDATE
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- NO INSERT policy: notifications are created by trusted server-side
-- application logic using the service role (supabaseAdmin). Clients
-- cannot create notifications for themselves or other users.
--
-- NO DELETE policy: notifications are permanent for MVP.

-- ═══════════════════════════════════════════════════════════════
-- 5. ENABLE REALTIME FOR NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════

DO $realtime$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END;
$realtime$;