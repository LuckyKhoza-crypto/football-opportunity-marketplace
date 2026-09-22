-- COMP-003: Competition Join Links & QR Entry Flow
--
-- Connects COMP-001/002 (foundation + event management + ambassadors) to the
-- first player-facing competition experience: a reusable, shareable join link
-- (rendered as a QR code) a participant scans to register for an event.
--
-- Architecture: a competition join link belongs to BOTH an event
-- (competition_events.id) AND an ambassador relationship
-- (competition_ambassadors.id). The owner is the AMBASSADOR RELATIONSHIP row,
-- not a raw profile id — knowing "which ambassador shared this link" requires
-- the competition-specific authorization row from COMP-001.
--
-- The link is REUSABLE. Many different participants may scan the same QR code;
-- each authenticated profile registers independently, enforced by the existing
-- UNIQUE(event_id, profile_id) constraint on competition_participants.
--
-- Token security (mirrors team invitations 0014/0015):
--   * raw token generated server-side with crypto.randomBytes(32) (256 bits)
--     and returned to the UI once, for the join URL / QR code.
--   * ONLY the SHA-256 hex digest is persisted (token_hash).
--   * a database leak therefore does not expose active join URLs.
--
-- Join-link state is DERIVED from timestamps (no status column):
--   revoked_at != null -> revoked; otherwise -> active.
--
-- Participant verification fields establish the pre-entry pass identifier so
-- later challenge/ambassador tickets (COMP-004/005) can locate a participant.
--
-- NOTE: this app uses NextAuth (JWT), so RLS is defense-in-depth and the
-- server-side supabaseAdmin client performs authoritative authorization.

-- ═══════════════════════════════════════════════════════════════
-- 1. COMPETITION JOIN LINKS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS competition_join_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  -- The ambassador relationship that owns/shares this link.
  ambassador_id UUID NOT NULL
    REFERENCES competition_ambassadors(id) ON DELETE CASCADE,
  -- SHA-256 hex digest of the raw join token. UNIQUE doubles as lookup index.
  token_hash TEXT NOT NULL UNIQUE,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. PARTICIPANT VERIFICATION FIELDS
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE competition_participants
  ADD COLUMN IF NOT EXISTS verification_code TEXT;

ALTER TABLE competition_participants
  ADD COLUMN IF NOT EXISTS verification_token_hash TEXT;

-- A participant's verification code must be globally unique so an ambassador
-- can locate a participant from the code alone.
CREATE UNIQUE INDEX IF NOT EXISTS competition_participants_verification_code_key
  ON competition_participants (verification_code)
  WHERE verification_code IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS competition_join_links_event_id_idx
  ON competition_join_links (event_id);

CREATE INDEX IF NOT EXISTS competition_join_links_ambassador_id_idx
  ON competition_join_links (ambassador_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE competition_join_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Event creator can read join links"
  ON competition_join_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_join_links.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

CREATE POLICY "Ambassador can read own join link"
  ON competition_join_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_ambassadors ca
      WHERE ca.id = competition_join_links.ambassador_id
      AND ca.profile_id::text = auth.uid()::text
    )
  );

CREATE POLICY "Event creator can create join links"
  ON competition_join_links
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_join_links.event_id
      AND ce.created_by::text = auth.uid()::text
    )
    AND EXISTS (
      SELECT 1 FROM competition_ambassadors ca
      WHERE ca.id = competition_join_links.ambassador_id
      AND ca.event_id = competition_join_links.event_id
    )
  );

CREATE POLICY "Event creator can update join links"
  ON competition_join_links
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_join_links.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

CREATE POLICY "Event creator can delete join links"
  ON competition_join_links
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM competition_events ce
      WHERE ce.id = competition_join_links.event_id
      AND ce.created_by::text = auth.uid()::text
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 5. TRIGGER FOR updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE TRIGGER set_competition_join_links_updated_at
  BEFORE UPDATE ON competition_join_links
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();