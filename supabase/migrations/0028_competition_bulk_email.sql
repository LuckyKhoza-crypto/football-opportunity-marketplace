-- T-BULK-1: Host/Ambassador "Email Participants" batches (bulk email outbox)
--
-- Adds the durable persistence an authorized competition host/ambassador needs
-- to email every ACTIVE registered participant of ONE competition. It reuses the
-- existing EMAIL-001 Brevo transport and the EMAIL-002 architecture (PostgreSQL
-- as the queue, atomic claiming, bounded retries, stale-'sending' recovery) —
-- without adding a job platform or a new external dependency.
--
-- Why two new tables (and not `email_notification_deliveries`)?
--
--   `email_notification_deliveries` is keyed 1:1 on
--   `notification_id UNIQUE NOT NULL` — it models "at most one email per in-app
--   notification" and resolves its content by REBUILDING a notification. A bulk
--   host message is not a notification, has many independent recipients and one
--   shared body, so the outbox is modelled separately:
--
--     competition_bulk_emails             -- ONE batch (the host's send request)
--       event_id                          -- the competition it belongs to
--       sent_by_profile_id                -- the authorized actor (session-derived)
--       request_id                        -- idempotency key (server-validated)
--       subject / body_text               -- the host's message, stored once
--       eligible_count / invalid_count /
--       duplicate_count                   -- audience resolution snapshot
--
--     competition_bulk_email_recipients   -- ONE row per (batch, recipient email)
--       batch_id / recipient_email        -- the deduplicated, normalized address
--       profile_id / recipient_name       -- resolved at enqueue (never trusted later)
--       status                            -- pending → sending → sent | failed
--       attempts / available_at           -- bounded retry + backoff
--       sent_at / last_error / provider_message_id
--
-- Privacy: recipient addresses live ONLY in this server-only table (RLS with no
-- client policies). They are never returned by an API response and are never put
-- in `To`/`CC` together — each recipient gets their OWN message.
--
-- NOTE: this app uses NextAuth (JWT) rather than Supabase Auth, so RLS is
-- defense-in-depth and the server-side supabaseAdmin client (service role)
-- performs the authoritative authorization checks. Nothing in these tables is
-- ever written from the browser.


-- ═══════════════════════════════════════════════════════════════
-- 1. BULK EMAIL BATCHES (one row per host send request)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS competition_bulk_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The competition the message belongs to. Deleting the competition removes its
  -- batches (and, by cascade, the recipient rows).
  event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  -- The authorized host/ambassador who requested the send (profiles.id). ON
  -- DELETE SET NULL keeps the batch as history if the actor is later deleted.
  sent_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Idempotency key for THIS batch, supplied by the composing screen (a UUID)
  -- and validated server-side. UNIQUE(event_id, request_id) makes an accidental
  -- repeat click / request retry return the EXISTING batch instead of creating a
  -- second send. The batch id itself is always server-generated.
  request_id TEXT NOT NULL,
  -- The host's message. Stored ONCE (the processor rebuilds each recipient's
  -- email from the validated, persisted values — never from the client again).
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  -- Audience resolution snapshot taken at enqueue time (server-observed):
  --   eligible_count   → recipient rows created (deduplicated + deliverable)
  --   invalid_count    → active participants skipped: missing/invalid address
  --   duplicate_count  → active participants skipped: duplicate normalized email
  eligible_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  invalid_count INTEGER NOT NULL DEFAULT 0 CHECK (invalid_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT competition_bulk_emails_request_key UNIQUE (event_id, request_id)
);

-- ═══════════════════════════════════════════════════════════════
-- 2. BULK EMAIL RECIPIENTS (one row per individual message)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS competition_bulk_email_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES competition_bulk_emails(id) ON DELETE CASCADE,
  -- The participant's profile (profiles.id). ON DELETE SET NULL keeps the
  -- delivery outcome even if the profile is later deleted.
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- The normalized (trimmed + lowercased) delivery address resolved server-side
  -- at enqueue time. Never returned by an API response.
  recipient_email TEXT NOT NULL,
  -- Optional display name resolved at enqueue time (display only).
  recipient_name TEXT,
  -- Independent per-recipient lifecycle. `pending`/`sending` = not yet accepted
  -- by the provider; `sent` = the provider ACCEPTED the message (never a claim
  -- of inbox delivery); `failed` = permanently rejected or retries exhausted.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  -- Number of send attempts started for this recipient.
  attempts INTEGER NOT NULL DEFAULT 0,
  -- Earliest time the row is eligible for (re)processing (retry backoff).
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  -- Safe, human-readable failure reason. NEVER contains secrets or addresses.
  last_error TEXT,
  -- Brevo-assigned message id (set when the provider accepted the message).
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One message per (batch, address). Case-insensitive by construction: the
  -- address is normalized before insert, so this is the database-level guarantee
  -- against duplicate sends inside one batch.
  CONSTRAINT competition_bulk_email_recipients_batch_email_key
    UNIQUE (batch_id, recipient_email)
);


-- ═══════════════════════════════════════════════════════════════
-- 3. INDEXES
-- ═══════════════════════════════════════════════════════════════

-- Primary worker access path: eligible (batch, status, available_at) rows.
CREATE INDEX IF NOT EXISTS competition_bulk_email_recipients_batch_status_idx
  ON competition_bulk_email_recipients (batch_id, status, available_at);

-- FK index for profile lookups / deletions (the unique key does not lead with it).
CREATE INDEX IF NOT EXISTS competition_bulk_email_recipients_profile_id_idx
  ON competition_bulk_email_recipients (profile_id);

-- Listing the most recent batches of one competition.
CREATE INDEX IF NOT EXISTS competition_bulk_emails_event_created_idx
  ON competition_bulk_emails (event_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 4. updated_at MAINTENANCE
-- ═══════════════════════════════════════════════════════════════
-- Reuses the shared update_updated_at_column() function (migration 00001).

DROP TRIGGER IF EXISTS set_competition_bulk_emails_updated_at
  ON competition_bulk_emails;

CREATE TRIGGER set_competition_bulk_emails_updated_at
  BEFORE UPDATE ON competition_bulk_emails
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_competition_bulk_email_recipients_updated_at
  ON competition_bulk_email_recipients;

CREATE TRIGGER set_competition_bulk_email_recipients_updated_at
  BEFORE UPDATE ON competition_bulk_email_recipients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════
-- 5. ENABLE RLS (NO CLIENT POLICIES)
-- ═══════════════════════════════════════════════════════════════
--
-- Recipient EMAIL ADDRESSES live in these tables, so they are never exposed to
-- clients at all: RLS is enabled with NO policies, which denies every anon /
-- authenticated request. All reads and writes happen through the server-side
-- service-role client (which bypasses RLS), after `canManageEvent` has been
-- re-checked in TypeScript.

ALTER TABLE competition_bulk_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_bulk_email_recipients ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════
-- 6. ATOMIC CLAIM (concurrency-safe, one recipient at a time)
-- ═══════════════════════════════════════════════════════════════
--
-- Mirrors the EMAIL-002 `claim_next_email_delivery` RPC, scoped to ONE batch:
--
--   * recovers rows stranded in 'sending' by a crashed worker (stale timeout),
--   * selects exactly one eligible 'pending' row
--     (available_at <= now() AND attempts < max attempts)
--     with FOR UPDATE SKIP LOCKED, so concurrent invocations never claim the
--     same recipient — and therefore never send the same email twice,
--   * flips it to 'sending' and increments `attempts` IN THE SAME transaction.

CREATE OR REPLACE FUNCTION claim_next_bulk_email_recipient(
  p_batch_id UUID,
  p_stale_seconds INTEGER DEFAULT 300,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS SETOF competition_bulk_email_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func_claim_next_bulk_email_recipient$
DECLARE
  v_id UUID;
BEGIN
  IF p_batch_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE competition_bulk_email_recipients
     SET status = 'pending',
         last_error = COALESCE(
           last_error,
           'Recovered from an interrupted send attempt (stale claim timeout).'
         ),
         updated_at = now()
   WHERE batch_id = p_batch_id
     AND status = 'sending'
     AND updated_at < now() - make_interval(secs => p_stale_seconds);

  SELECT id INTO v_id
    FROM competition_bulk_email_recipients
   WHERE batch_id = p_batch_id
     AND status = 'pending'
     AND available_at <= now()
     AND attempts < p_max_attempts
   ORDER BY available_at ASC, created_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE competition_bulk_email_recipients
     SET status = 'sending',
         attempts = attempts + 1,
         updated_at = now()
   WHERE id = v_id
   RETURNING *;
END;
$func_claim_next_bulk_email_recipient$;

-- ═══════════════════════════════════════════════════════════════
-- 7. RESTRICT EXECUTE TO THE SERVICE ROLE
-- ═══════════════════════════════════════════════════════════════
-- The claim function mutates the outbox and must never be callable by
-- anon/authenticated clients. On Supabase the roles exist; on a bare Postgres
-- (local tests) the guard is a no-op.

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION claim_next_bulk_email_recipient(uuid, integer, integer) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION claim_next_bulk_email_recipient(uuid, integer, integer) TO service_role';
  END IF;
END;
$grants$;
