-- TEAM-002: Team Invitation Data Model
--
-- This migration adds the canonical representation of
-- "this team has issued an invitation that a player can later accept":
--
--   Team Profile ←→ Invite
--
-- Each invite belongs to a SPECIFIC team_profile_id — never merely to a
-- manager's profiles.id. This is required for the multi-team architecture
-- (one manager → many team profiles).
--
-- Security model:
--   * The raw invite token is generated server-side with crypto.randomBytes
--     and returned to the manager exactly once, at creation time.
--   * Only a SHA-256 digest of the token is persisted in token_hash.
--   * A database leak therefore does not expose active invite URLs.
--
-- Invite state is DERIVED from timestamps (no status column):
--   accepted_at != null  → accepted
--   revoked_at  != null  → revoked
--   expires_at  <= now() → expired
--   otherwise            → pending
--
-- NOTE: Do NOT add a status column. Derived state cannot drift out of sync.

-- ═══════════════════════════════════════════════════════════════
-- 1. CREATE TEAM INVITES TABLE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS team_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The specific team this invite belongs to. Multi-team safe: never
  -- inferred from the manager's user_id.
  team_profile_id UUID NOT NULL REFERENCES team_profiles(id) ON DELETE CASCADE,
  -- SHA-256 hex digest of the raw invite token. The raw token is never
  -- persisted. UNIQUE enforces token uniqueness at the database level.
  token_hash TEXT NOT NULL UNIQUE,
  -- The profiles.id of the manager who created the invite.
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Invites expire. An invite is invalid when expires_at <= now().
  expires_at TIMESTAMPTZ NOT NULL,
  -- Populated when the invite is accepted (TEAM-003). Nullable until then.
  accepted_at TIMESTAMPTZ,
  -- The profiles.id of the user who accepted the invite. Nullable until
  -- acceptance. SET NULL on profile deletion so invite history survives.
  accepted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Populated when the manager revokes the invite. Revocation preserves
  -- the row for history/auditing rather than deleting it.
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. INDEXES
-- ═══════════════════════════════════════════════════════════════
--
-- Token lookup is served by the UNIQUE constraint on token_hash
-- (PostgreSQL creates a unique index for it), so no redundant index
-- is created for token lookups.

-- Efficient query: "all invites for a team".
CREATE INDEX IF NOT EXISTS team_invites_team_profile_id_idx
  ON team_invites (team_profile_id);

-- Efficient query: "pending/non-revoked invites for a team" (used by
-- future invite-management UI and by acceptance flows).
CREATE INDEX IF NOT EXISTS team_invites_pending_team_idx
  ON team_invites (team_profile_id, expires_at)
  WHERE revoked_at IS NULL AND accepted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. ENABLE ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;

-- ─── Team Policies ─────────────────────────────────────────────
--
-- All team policies verify ownership of the SPECIFIC team_profile_id,
-- never just the authenticated user's profile. This is required for
-- the multi-team architecture: a manager owning Team A and Team B
-- can only access invites scoped to the team being operated on.
-- These policies do NOT assume team_profiles.user_id is unique.
--
-- NOTE: The application's real authorization layer is NextAuth +
-- server-side checks using supabaseAdmin. RLS is defense-in-depth.

-- Team can view invites for their own team profile
CREATE POLICY "Team can view own team invites"
  ON team_invites
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_profiles tp
      WHERE tp.id = team_invites.team_profile_id
      AND tp.user_id::text = auth.uid()::text
    )
  );

-- Team can create invites for their own team profile
CREATE POLICY "Team can create invites for own team"
  ON team_invites
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_profiles tp
      WHERE tp.id = team_invites.team_profile_id
      AND tp.user_id::text = auth.uid()::text
    )
  );

-- Team can update invites for their own team profile
-- (used for revocation: revoked_at = now())
CREATE POLICY "Team can update own team invites"
  ON team_invites
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_profiles tp
      WHERE tp.id = team_invites.team_profile_id
      AND tp.user_id::text = auth.uid()::text
    )
  );

-- Team can delete invites for their own team profile
CREATE POLICY "Team can delete own team invites"
  ON team_invites
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM team_profiles tp
      WHERE tp.id = team_invites.team_profile_id
      AND tp.user_id::text = auth.uid()::text
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 4. TRIGGER FOR updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE TRIGGER set_team_invites_updated_at
  BEFORE UPDATE ON team_invites
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();