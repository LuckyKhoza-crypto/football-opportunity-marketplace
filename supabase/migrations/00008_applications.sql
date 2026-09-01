-- Create applications table for player-to-opportunity applications
-- 
-- This table enables the full application lifecycle:
-- - Players apply to opportunities
-- - Teams review and manage applications
-- - Status tracks the application state

-- Create the applications table
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  player_profile_id UUID NOT NULL REFERENCES player_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'accepted', 'rejected', 'withdrawn')),
  cover_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  -- Prevent duplicate applications from the same player to the same opportunity
  UNIQUE(opportunity_id, player_profile_id)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS applications_opportunity_id_idx ON applications (opportunity_id);
CREATE INDEX IF NOT EXISTS applications_player_profile_id_idx ON applications (player_profile_id);
CREATE INDEX IF NOT EXISTS applications_status_idx ON applications (status);

-- Enable Row Level Security
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

-- ─── Player Policies ─────────────────────────────────────────────

-- Player can create an application for themselves
-- But NOT to their own team's opportunity (self-application prevention)
CREATE POLICY "Player can create own application"
  ON applications
  FOR INSERT
  WITH CHECK (
    -- The authenticated user must own the player profile
    auth.uid()::text = (SELECT user_id::text FROM player_profiles WHERE id = player_profile_id)
    -- AND the opportunity must not be owned by the same user
    AND NOT EXISTS (
      SELECT 1 FROM opportunities o
      JOIN team_profiles tp ON tp.id = o.team_id
      WHERE o.id = opportunity_id AND tp.user_id::text = auth.uid()::text
    )
    -- AND the opportunity must be active
    AND EXISTS (
      SELECT 1 FROM opportunities o
      WHERE o.id = opportunity_id AND o.status = 'active'
    )
  );

-- Player can view their own applications
CREATE POLICY "Player can view own applications"
  ON applications
  FOR SELECT
  USING (
    auth.uid()::text = (SELECT user_id::text FROM player_profiles WHERE id = player_profile_id)
  );

-- Player can withdraw their own pending or reviewing applications
CREATE POLICY "Player can withdraw own application"
  ON applications
  FOR UPDATE
  USING (
    auth.uid()::text = (SELECT user_id::text FROM player_profiles WHERE id = player_profile_id)
    AND status IN ('pending', 'reviewing')
  )
  WITH CHECK (
    status = 'withdrawn'
  );

-- ─── Team Policies ───────────────────────────────────────────────

-- Team can view applications submitted to opportunities they own
CREATE POLICY "Team can view applications for own opportunities"
  ON applications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM opportunities o
      JOIN team_profiles tp ON tp.id = o.team_id
      WHERE o.id = opportunity_id AND tp.user_id::text = auth.uid()::text
    )
  );

-- Team can update application status for their own opportunities
CREATE POLICY "Team can update application status"
  ON applications
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM opportunities o
      JOIN team_profiles tp ON tp.id = o.team_id
      WHERE o.id = opportunity_id AND tp.user_id::text = auth.uid()::text
    )
  );

-- Trigger to auto-update updated_at
CREATE TRIGGER set_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();