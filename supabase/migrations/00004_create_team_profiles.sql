-- Create team_profiles table
CREATE TABLE IF NOT EXISTS team_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  logo_url TEXT,
  location TEXT,
  league TEXT,
  playing_level TEXT,
  description TEXT,
  website_url TEXT,
  social_links JSONB DEFAULT '[]'::jsonb,
  contact_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS team_profiles_user_id_idx ON team_profiles (user_id);

-- Enable Row Level Security
ALTER TABLE team_profiles ENABLE ROW LEVEL SECURITY;

-- User can create their own team profile
CREATE POLICY "User can create own team profile"
  ON team_profiles
  FOR INSERT
  WITH CHECK (auth.uid()::text = user_id::text);

-- User can read their own team profile
CREATE POLICY "User can read own team profile"
  ON team_profiles
  FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- User can update their own team profile
CREATE POLICY "User can update own team profile"
  ON team_profiles
  FOR UPDATE
  USING (auth.uid()::text = user_id::text);

-- User can delete their own team profile
CREATE POLICY "User can delete own team profile"
  ON team_profiles
  FOR DELETE
  USING (auth.uid()::text = user_id::text);

-- Trigger to auto-update updated_at
CREATE TRIGGER set_team_profiles_updated_at
  BEFORE UPDATE ON team_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();