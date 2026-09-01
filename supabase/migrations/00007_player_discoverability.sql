-- Player Discoverability for Team-Side Player Discovery
-- 
-- Adds a discoverable flag to player_profiles so players can control
-- whether they appear in team discovery.
--
-- Also adds RLS policy so teams can read discoverable player profiles.
-- Players can update their own discoverable setting.

-- Add discoverable column (default true — players opt in by completing profile)
ALTER TABLE player_profiles
  ADD COLUMN IF NOT EXISTS discoverable BOOLEAN DEFAULT TRUE;

-- Add index for team discovery filtering
CREATE INDEX IF NOT EXISTS player_profiles_discoverable_idx ON player_profiles (discoverable);

-- Add indexes for common search/filter fields used in team player discovery
CREATE INDEX IF NOT EXISTS player_profiles_positions_idx ON player_profiles USING GIN (positions);
CREATE INDEX IF NOT EXISTS player_profiles_playing_level_idx ON player_profiles (playing_level);
CREATE INDEX IF NOT EXISTS player_profiles_availability_idx ON player_profiles (availability);
CREATE INDEX IF NOT EXISTS player_profiles_preferred_foot_idx ON player_profiles (preferred_foot);
CREATE INDEX IF NOT EXISTS player_profiles_created_at_idx ON player_profiles (created_at DESC);

-- Policy: Any authenticated user (including teams) can read discoverable player profiles
-- This enables team-side player discovery while respecting player privacy
CREATE POLICY "Anyone can read discoverable profiles"
  ON player_profiles
  FOR SELECT
  USING (
    discoverable = true
    OR auth.uid()::text = user_id::text  -- Players can always see their own
  );

-- Policy: Player can update their own discoverable setting
CREATE POLICY "Player can update own discoverable"
  ON player_profiles
  FOR UPDATE
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);