-- Create opportunities table
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES team_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position TEXT,
  secondary_positions TEXT[] DEFAULT '{}',
  role TEXT,
  formation TEXT,
  age_min INTEGER,
  age_max INTEGER,
  playing_level TEXT,
  league TEXT,
  location TEXT,
  radius INTEGER,
  preferred_foot TEXT,
  availability TEXT,
  compensation TEXT,
  housing TEXT,
  travel_requirements TEXT,
  visa_requirements TEXT,
  contract_length TEXT,
  tryout_date DATE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index on team_id for fast lookups
CREATE INDEX IF NOT EXISTS opportunities_team_id_idx ON opportunities (team_id);
CREATE INDEX IF NOT EXISTS opportunities_status_idx ON opportunities (status);

-- Enable Row Level Security
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

-- Team can create opportunities for their own team profile
CREATE POLICY "Team can create own opportunities"
  ON opportunities
  FOR INSERT
  WITH CHECK (
    auth.uid()::text = (
      SELECT user_id::text FROM team_profiles WHERE id = team_id
    )
  );

-- Team can read their own opportunities
CREATE POLICY "Team can read own opportunities"
  ON opportunities
  FOR SELECT
  USING (
    auth.uid()::text = (
      SELECT user_id::text FROM team_profiles WHERE id = team_id
    )
  );

-- Team can update their own opportunities
CREATE POLICY "Team can update own opportunities"
  ON opportunities
  FOR UPDATE
  USING (
    auth.uid()::text = (
      SELECT user_id::text FROM team_profiles WHERE id = team_id
    )
  );

-- Team can delete their own opportunities
CREATE POLICY "Team can delete own opportunities"
  ON opportunities
  FOR DELETE
  USING (
    auth.uid()::text = (
      SELECT user_id::text FROM team_profiles WHERE id = team_id
    )
  );

-- Trigger to auto-update updated_at
CREATE TRIGGER set_opportunities_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();