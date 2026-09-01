-- Create player_profiles table
CREATE TABLE IF NOT EXISTS player_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  profile_photo_url TEXT,
  date_of_birth DATE,
  location TEXT,
  positions TEXT[] DEFAULT '{}',
  preferred_role TEXT,
  playing_level TEXT,
  preferred_foot TEXT,
  availability TEXT,
  willing_to_travel BOOLEAN DEFAULT FALSE,
  willing_to_relocate BOOLEAN DEFAULT FALSE,
  travel_radius INTEGER,
  compensation_expectation TEXT,
  previous_clubs JSONB DEFAULT '[]'::jsonb,
  stats JSONB DEFAULT '{}'::jsonb,
  achievements TEXT[] DEFAULT '{}',
  highlight_video_url TEXT,
  preferred_leagues TEXT[] DEFAULT '{}',
  bio TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS player_profiles_user_id_idx ON player_profiles (user_id);

-- Enable Row Level Security
ALTER TABLE player_profiles ENABLE ROW LEVEL SECURITY;

-- Player can create their own player profile
CREATE POLICY "Player can create own profile"
  ON player_profiles
  FOR INSERT
  WITH CHECK (auth.uid()::text = user_id::text);

-- Player can read their own player profile
CREATE POLICY "Player can read own profile"
  ON player_profiles
  FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- Player can update their own player profile
CREATE POLICY "Player can update own profile"
  ON player_profiles
  FOR UPDATE
  USING (auth.uid()::text = user_id::text);

-- Player can delete their own player profile
CREATE POLICY "Player can delete own profile"
  ON player_profiles
  FOR DELETE
  USING (auth.uid()::text = user_id::text);

-- Trigger to auto-update updated_at
CREATE TRIGGER set_player_profiles_updated_at
  BEFORE UPDATE ON player_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();