-- FOM-EMAIL-ANNOUNCEMENTS-001: Admin "Email Users" announcements
--
-- Adds the durable persistence the admin-only "Email Users" feature needs to
-- email an ADMIN-SELECTED audience (all users, or the participants of a previous
-- competition), optionally promoting an upcoming competition with a registration
-- link. It reuses the existing EMAIL-001 Brevo transport and the EMAIL-002
-- architecture (PostgreSQL as the queue, atomic claiming, bounded retries,
-- stale-'sending' recovery) — without adding a job platform or a new dependency.
--
-- This is a SEPARATE feature from the competition "Email Participants" pipeline
-- (T-BULK-1, migration 0028). Nothing in migration 0028 is modified, dropped or
-- relaxed here, and no existing table is altered.
--
-- Why new tables (and not `competition_bulk_emails`)?
--   The competition outbox is keyed to ONE `event_id` and resolves its audience
--   from that event's participants. An admin announcement has NO owning event: it
--   addresses either the whole `profiles` table or the participants of an
--   ARBITRARY historical event, and may separately promote ANOTHER event. The
--   audience model is therefore different, so it is modelled separately:
--
--     email_announcement_batches          -- ONE batch (the admin's send request)
--       audience_type                     -- 'all_users' | 'previous_competition'
--       previous_event_id                 -- the audience competition (nullable)
--       promotion_event_id / promotion_url-- the optional promoted competition
--       image_url                         -- the optional uploaded image
--       sent_by_profile_id                -- the acting admin (session-derived)
--       request_id                        -- idempotency key (server-validated)
--       subject / body_text               -- the admin's message, stored once
--       eligible_count / invalid_count /
--       duplicate_count /
--       excluded_registered_count         -- audience resolution snapshot
--
--     email_announcement_recipients       -- ONE row per (batch, recipient email)
--       batch_id / recipient_email        -- the deduplicated, normalized address
--       profile_id / recipient_name       -- resolved at enqueue (never trusted later)
--       status                            -- pending → sending → sent | failed
--       attempts / available_at           -- bounded retry + backoff
--       sent_at / last_error / provider_message_id
--
--     email_announcement_promotion_links  -- ONE resolved registration link per
--       event_id (PK)                       promoted competition, so the preview
--       join_link_id                        and the delivered email use the EXACT
--       raw_url                             same URL and repeated previews never
--       created_by_profile_id               create duplicate join links.
--
-- Token security: `competition_join_links` still stores ONLY the SHA-256
-- `token_hash` — no plaintext token column is added anywhere. `raw_url` above is
-- the RESOLVED absolute join URL this feature must reuse verbatim (it is the same
-- URL the email itself contains). It lives only in this server-only table.
--
-- Privacy: recipient addresses live ONLY in the server-only tables below (RLS
-- with no client policies). They are never returned by an API response and are
-- never put in `To`/`CC` together — each recipient gets their OWN message.
--
-- NOTE: this app uses NextAuth (JWT) rather than Supabase Auth, so RLS is
-- defense-in-depth and the server-side supabaseAdmin client (service role)
-- performs the authoritative authorization checks. Nothing in these tables is
-- ever written from the browser.

-- ═══════════════════════════════════════════════════════════════
-- 1. ANNOUNCEMENT BATCHES (one row per admin send request)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_announcement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who the announcement addresses.
  audience_type TEXT NOT NULL
    CHECK (audience_type IN ('all_users', 'previous_competition')),
  -- The audience competition (required for 'previous_competition'). Kept as
  -- history if the competition is later deleted.
  previous_event_id UUID REFERENCES competition_events(id) ON DELETE SET NULL,
  -- The optional promoted competition and the EXACT registration URL used for
  -- this send (the same URL the preview showed).
  promotion_event_id UUID REFERENCES competition_events(id) ON DELETE SET NULL,
  promotion_url TEXT,
  -- The optional uploaded image URL (public Supabase Storage object).
  image_url TEXT,
  -- The authorized administrator who requested the send (profiles.id).
  sent_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Idempotency key for THIS batch, supplied by the composing screen (a UUID)
  -- and validated server-side. UNIQUE(request_id) makes an accidental repeat
  -- click / request retry return the EXISTING batch instead of creating a second
  -- send. The batch id itself is always server-generated.
  request_id TEXT NOT NULL,
  -- The admin's message. Stored ONCE (the processor rebuilds each recipient's
  -- email from the validated, persisted values — never from the client again).
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  -- Audience resolution snapshot taken at enqueue time (server-observed):
  --   eligible_count            → recipient rows created (deduplicated + deliverable)
  --   invalid_count             → skipped: missing/invalid address
  --   duplicate_count           → skipped: duplicate normalized email/profile
  --   excluded_registered_count → skipped: already registered for the promoted event
  eligible_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  invalid_count INTEGER NOT NULL DEFAULT 0 CHECK (invalid_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  excluded_registered_count INTEGER NOT NULL DEFAULT 0
    CHECK (excluded_registered_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_announcement_batches_request_key UNIQUE (request_id)
);


-- ═══════════════════════════════════════════════════════════════
-- 2. ANNOUNCEMENT RECIPIENTS (one row per individual message)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_announcement_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES email_announcement_batches(id) ON DELETE CASCADE,
  -- The recipient's profile (profiles.id). ON DELETE SET NULL keeps the
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
  CONSTRAINT email_announcement_recipients_batch_email_key
    UNIQUE (batch_id, recipient_email)
);

-- ═══════════════════════════════════════════════════════════════
-- 3. RESOLVED PROMOTION REGISTRATION LINKS (one per competition)
-- ═══════════════════════════════════════════════════════════════
--
-- Reuse without regeneration: the primary key on `event_id` guarantees at most
-- ONE resolved registration URL per promoted competition, so refreshing the
-- preview never creates another join link, and two concurrent previews cannot
-- leave two behind (the loser's link is discarded).
--
-- `join_link_id` references the EXISTING `competition_join_links` row (which
-- still stores only the SHA-256 token hash). `raw_url` is the resolved absolute
-- join URL — the very URL embedded in the email — and is therefore stored here
-- so preview and delivery always agree.

CREATE TABLE IF NOT EXISTS email_announcement_promotion_links (
  event_id UUID PRIMARY KEY REFERENCES competition_events(id) ON DELETE CASCADE,
  join_link_id UUID NOT NULL REFERENCES competition_join_links(id) ON DELETE CASCADE,
  raw_url TEXT NOT NULL,
  created_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════════
-- 4. INDEXES
-- ═══════════════════════════════════════════════════════════════

-- Primary worker access path: eligible (batch, status, available_at) rows.
CREATE INDEX IF NOT EXISTS email_announcement_recipients_batch_status_idx
  ON email_announcement_recipients (batch_id, status, available_at);

-- FK index for profile lookups / deletions (the unique key does not lead with it).
CREATE INDEX IF NOT EXISTS email_announcement_recipients_profile_id_idx
  ON email_announcement_recipients (profile_id);

-- Listing the most recent announcement batches.
CREATE INDEX IF NOT EXISTS email_announcement_batches_created_idx
  ON email_announcement_batches (created_at DESC);

-- FK index for the promoted competition's link.
CREATE INDEX IF NOT EXISTS email_announcement_promotion_links_join_link_idx
  ON email_announcement_promotion_links (join_link_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. updated_at MAINTENANCE
-- ═══════════════════════════════════════════════════════════════
-- Reuses the shared update_updated_at_column() function (migration 00001).

DROP TRIGGER IF EXISTS set_email_announcement_batches_updated_at
  ON email_announcement_batches;

CREATE TRIGGER set_email_announcement_batches_updated_at
  BEFORE UPDATE ON email_announcement_batches
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_email_announcement_recipients_updated_at
  ON email_announcement_recipients;

CREATE TRIGGER set_email_announcement_recipients_updated_at
  BEFORE UPDATE ON email_announcement_recipients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_email_announcement_promotion_links_updated_at
  ON email_announcement_promotion_links;

CREATE TRIGGER set_email_announcement_promotion_links_updated_at
  BEFORE UPDATE ON email_announcement_promotion_links
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════
-- 6. ENABLE RLS (NO CLIENT POLICIES)
-- ═══════════════════════════════════════════════════════════════
--
-- Recipient EMAIL ADDRESSES live in these tables, so they are never exposed to
-- clients at all: RLS is enabled with NO policies, which denies every anon /
-- authenticated request. All reads and writes happen through the server-side
-- service-role client (which bypasses RLS), after the administrator capability
-- has been re-checked in TypeScript.

ALTER TABLE email_announcement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_announcement_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_announcement_promotion_links ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════
-- 7. ATOMIC CLAIM (concurrency-safe, one recipient at a time)
-- ═══════════════════════════════════════════════════════════════
--
-- Mirrors the EMAIL-002 `claim_next_email_delivery` RPC (and the T-BULK-1
-- `claim_next_bulk_email_recipient`), scoped to ONE announcement batch:
--
--   * recovers rows stranded in 'sending' by a crashed worker (stale timeout),
--   * selects exactly one eligible 'pending' row
--     (available_at <= now() AND attempts < max attempts)
--     with FOR UPDATE SKIP LOCKED, so concurrent invocations never claim the
--     same recipient — and therefore never send the same email twice,
--   * flips it to 'sending' and increments `attempts` IN THE SAME transaction.

CREATE OR REPLACE FUNCTION claim_next_announcement_recipient(
  p_batch_id UUID,
  p_stale_seconds INTEGER DEFAULT 300,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS SETOF email_announcement_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func_claim_next_announcement_recipient$
DECLARE
  v_id UUID;
BEGIN
  IF p_batch_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE email_announcement_recipients
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
    FROM email_announcement_recipients
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
  UPDATE email_announcement_recipients
     SET status = 'sending',
         attempts = attempts + 1,
         updated_at = now()
   WHERE id = v_id
   RETURNING *;
END;
$func_claim_next_announcement_recipient$;

-- ═══════════════════════════════════════════════════════════════
-- 8. RESTRICT EXECUTE TO THE SERVICE ROLE
-- ═══════════════════════════════════════════════════════════════
-- The claim function mutates the outbox and must never be callable by
-- anon/authenticated clients. On Supabase the roles exist; on a bare Postgres
-- (local tests) the guard is a no-op.

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION claim_next_announcement_recipient(uuid, integer, integer) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION claim_next_announcement_recipient(uuid, integer, integer) TO service_role';
  END IF;
END;
$grants$;

