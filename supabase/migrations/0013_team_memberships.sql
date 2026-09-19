-- TEAM-001: Team Membership Data Model
--
-- This migration adds the canonical representation of
-- "this player is a member of this team":
--
--   Team Profile ←→ Player Profile
--
-- Future flows (invite acceptance, accepted applications) will both
-- create the same type of membership record in this table.
--
-- NOTE: Do NOT add team_id to player_profiles and do NOT modify
-- profiles.role to represent membership — membership is a separate
-- domain concept from the user's marketplace role.

-- ═══════════════════════════════════════════════════════════════
-- 1. CREATE TEAM MEMBERSHIPS TABLE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_profile_id UUID NOT NULL REFERENCES team_profiles(id) ON DELETE CASCADE,
  player_profile_id UUID NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE,
  -- Team-specific position for this player within this team relationship.
  -- Independent of player_profiles.positions (general marketplace profile).
  position TEXT,
  -- Team-specific role for this player within this team relationship.
  -- Independent of player_profiles.preferred_role (general marketplace profile).
  role TEXT,
  -- MVP membership lifecycle: only 'active' is supported for now.
  -- Widening this CHECK is the only change needed when additional
  -- membership statuses become a real requirement.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active')),
  joined_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. MVP ONE-PLAYER-ONE-TEAM CONSTRAINT
-- ═══════════════════════════════════════════════════════════════
--
-- Current MVP: a player may belong to only ONE team at a time.
--
-- Implemented as a named UNIQUE index on player_profile_id. This
-- prevents two teams from simultaneously creating memberships for
-- the same player.
--
-- Future model (player → many teams): drop this index and replace it
-- with UNIQUE (team_profile_id, player_profile_id). No other schema
-- redesign is required.
CREATE UNIQUE INDEX IF NOT EXISTS team_memberships_player_profile_id_key
  ON team_memberships (player_profile_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. INDEXES
-- ═══════════════════════════════════════════════════════════════
--
-- Efficient query: "all members of a team".
-- ("the team membership for a player" is served by the unique index
-- above, so no redundant index is created for it.)
CREATE INDEX IF NOT EXISTS team_memberships_team_profile_id_idx
  ON team_memberships (team_profile_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. ENABLE ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE team_memberships ENABLE ROW LEVEL SECURITY;

-- ─── Team Policies ─────────────────────────────────────────────
--
-- All team policies verify ownership of the SPECIFIC team_profile_id,
-- never just the authenticated user's profile. This is required for
-- the multi-team architecture: a manager owning Team A and Team B
-- can only access memberships scoped to the team being operated on.
-- These policies do NOT assume team_profiles.user_id is unique.

-- Team can view memberships for their own team profile
CREATE POLICY "Team can view own team memberships"
  ON team_memberships
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_profiles tp
      WHERE tp.id = team_memberships.team_profile_id
      AND tp.user_id::text = auth.uid()::text
    )
  );

-- Team can create memberships for their own team profile
CREATE POLICY "Team can create memberships for own team"
  ON team_memberships
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_profiles tp
      WHERE tp.id = team_memberships.team_profile_id
      AND tp.user_id::text = auth.uid()::text
    )
  );

-- Team can update memberships for their own team profile
CREATE POLICY "Team can update own team memberships"
  ON team_memberships
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_profiles tp
      WHERE tp.id = team_memberships.team_profile_id
      AND tp.user_id::text = auth.uid()::text
    )
  );

-- Team can delete memberships for their own team profile
CREATE POLICY "Team can delete own team memberships"
  ON team_memberships
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM team_profiles tp
      WHERE tp.id = team_memberships.team_profile_id
      AND tp.user_id::text = auth.uid()::text
    )
  );

-- ─── Player Policies ───────────────────────────────────────────
--
-- A player can view memberships that reference their own
-- player profile. MVP is read-only: player leave/switching flows
-- are intentionally out of scope for TEAM-001.

CREATE POLICY "Player can view own team memberships"
  ON team_memberships
  FOR SELECT
  USING (
    auth.uid()::text = (
      SELECT user_id::text FROM player_profiles
      WHERE id = team_memberships.player_profile_id
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- 5. TRIGGER FOR updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE TRIGGER set_team_memberships_updated_at
  BEFORE UPDATE ON team_memberships
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();