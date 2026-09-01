-- Allow anyone (including unauthenticated users) to read active opportunities
-- This is needed for the public marketplace / opportunities browsing experience
CREATE POLICY "Anyone can read active opportunities"
  ON opportunities
  FOR SELECT
  USING (status = 'active');

-- Add indexes for marketplace queries (filtering, sorting, searching)
CREATE INDEX IF NOT EXISTS opportunities_position_idx ON opportunities (position);
CREATE INDEX IF NOT EXISTS opportunities_playing_level_idx ON opportunities (playing_level);
CREATE INDEX IF NOT EXISTS opportunities_league_idx ON opportunities (league);
CREATE INDEX IF NOT EXISTS opportunities_availability_idx ON opportunities (availability);
CREATE INDEX IF NOT EXISTS opportunities_created_at_idx ON opportunities (created_at DESC);
CREATE INDEX IF NOT EXISTS opportunities_tryout_date_idx ON opportunities (tryout_date);