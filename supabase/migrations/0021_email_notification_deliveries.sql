-- EMAIL-002: Durable email notification outbox
--
-- This migration adds the durable queue that decouples transactional email from
-- in-app notification creation.
--
-- Architecture (unchanged canonical source layer):
--
--   notifications  ──► email_notification_deliveries  ──► processor ──► Brevo
--
-- `notifications` remains the canonical event/source. This table adds a
-- SEPARATE lifecycle for email delivery so that Brevo latency/downtime can
-- never affect the marketplace operation that raised the notification.
--
-- This migration adds:
--   1. email_notification_deliveries table (ONE row per notification)
--   2. indexes for the delivery worker (status, available_at)
--   3. updated_at maintenance (reuses update_updated_at_column())
--   4. RLS with NO client policies (server-only access via service role)
--   5. claim_next_email_delivery(...) — concurrency-safe, atomic claim
--   6. requeue_stale_email_deliveries(...) — stale 'sending' recovery
--
-- No marketplace RPC, notification UI, or Realtime publication is touched.

-- ═══════════════════════════════════════════════════════════════
-- 1. CREATE EMAIL NOTIFICATION DELIVERIES TABLE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A single in-app notification can produce AT MOST one email delivery.
  -- UNIQUE + NOT NULL enforces this at the database level.
  notification_id UUID NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
  -- Recipient resolved server-side from profiles.email at enqueue time.
  recipient_email TEXT NOT NULL,
  -- Independent email lifecycle (pending → sending → sent/failed/skipped).
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  -- Number of send attempts started for this delivery.
  attempts INTEGER NOT NULL DEFAULT 0,
  -- Earliest time the row is eligible for (re)processing. Used for backoff.
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  -- Safe, human-readable failure reason. NEVER contains secrets or request bodies.
  last_error TEXT,
  -- Brevo-assigned message id (set on success).
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. INDEXES
-- ═══════════════════════════════════════════════════════════════

-- Primary worker access path: find eligible (status, available_at) rows.
CREATE INDEX IF NOT EXISTS email_notification_deliveries_status_available_at_idx
  ON email_notification_deliveries (status, available_at);

-- The UNIQUE(notification_id) constraint already provides an index for
-- notification_id lookups, so no additional index is created here.

-- ═══════════════════════════════════════════════════════════════
-- 3. updated_at MAINTENANCE
-- ═══════════════════════════════════════════════════════════════
-- Reuses the shared update_updated_at_column() function (migration 00001).

DROP TRIGGER IF EXISTS set_email_notification_deliveries_updated_at
  ON email_notification_deliveries;

CREATE TRIGGER set_email_notification_deliveries_updated_at
  BEFORE UPDATE ON email_notification_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════
-- 4. ENABLE RLS (NO CLIENT POLICIES)
-- ═══════════════════════════════════════════════════════════════
--
-- The delivery table contains recipient email addresses and internal provider
-- state. It must NOT be exposed to normal clients.
--
-- Intentionally NO SELECT / INSERT / UPDATE / DELETE policy is created.
-- With RLS enabled and zero policies, anon/authenticated receive nothing.
-- Server-side code reaches this table through the service-role client
-- (supabaseAdmin), which bypasses RLS.

ALTER TABLE email_notification_deliveries ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- 5. ATOMIC CLAIM
-- ═══════════════════════════════════════════════════════════════
--
-- Concurrency safety: two workers must never send the same email.
--
-- Instead of a fragile "SELECT pending rows, then UPDATE later", this function
-- performs an atomic claim under a row lock with FOR UPDATE SKIP LOCKED:
--   * it first recovers any row stranded in 'sending' by a crashed worker
--     (older than p_stale_seconds), moving it back to 'pending';
--   * it selects ONE eligible row (status='pending', attempts < p_max_attempts,
--     available_at <= now()) with FOR UPDATE SKIP LOCKED;
--   * it flips the row to 'sending' and increments attempts in the same
--     transaction, returning the claimed row.
--
-- A second concurrent invocation skips the locked row and claims a different
-- one (or none). attempts is incremented on claim, so `attempts` reflects the
-- attempt currently in flight.

CREATE OR REPLACE FUNCTION claim_next_email_delivery(
  p_stale_seconds INTEGER DEFAULT 300,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS SETOF email_notification_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Recover deliveries stranded in 'sending' by a crashed worker.
  UPDATE email_notification_deliveries
     SET status = 'pending',
         last_error = COALESCE(
           last_error,
           'Recovered from an interrupted send attempt (stale claim timeout).'
         ),
         updated_at = now()
   WHERE status = 'sending'
     AND updated_at < now() - make_interval(secs => p_stale_seconds);

  SELECT id INTO v_id
    FROM email_notification_deliveries
   WHERE status = 'pending'
     AND available_at <= now()
     AND attempts < p_max_attempts
   ORDER BY available_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE email_notification_deliveries
     SET status = 'sending',
         attempts = attempts + 1,
         updated_at = now()
   WHERE id = v_id
   RETURNING *;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 6. STALE 'sending' RECOVERY (explicit helper)
-- ═══════════════════════════════════════════════════════════════
--
-- The claim function already recovers stale rows inline. This helper is exposed
-- so a scheduler (or an operator) can proactively requeue stranded rows.

CREATE OR REPLACE FUNCTION requeue_stale_email_deliveries(
  p_stale_seconds INTEGER DEFAULT 300
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE email_notification_deliveries
     SET status = 'pending',
         last_error = COALESCE(
           last_error,
           'Recovered from an interrupted send attempt (stale claim timeout).'
         ),
         updated_at = now()
   WHERE status = 'sending'
     AND updated_at < now() - make_interval(secs => p_stale_seconds);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 7. RESTRICT EXECUTE TO THE SERVICE ROLE
-- ═══════════════════════════════════════════════════════════════
--
-- These SECURITY DEFINER functions mutate the outbox. They must never be
-- callable by anon/authenticated clients. On Supabase the roles exist; on a
-- bare Postgres (local tests) the guard is a no-op.

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION claim_next_email_delivery(integer, integer) FROM PUBLIC';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION requeue_stale_email_deliveries(integer) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION claim_next_email_delivery(integer, integer) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION requeue_stale_email_deliveries(integer) TO service_role';
  END IF;
END;
$grants$;