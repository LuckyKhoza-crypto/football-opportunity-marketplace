-- Create the profiles table for application-level user data
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT CHECK (role IN ('player', 'team')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create an index on email for lookups
CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles (email);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON profiles
  FOR SELECT
  USING (auth.uid()::text = id::text OR email = current_setting('request.jwt.claims', true)::jsonb ->> 'email');

-- Users can create their own profile
CREATE POLICY "Users can create own profile"
  ON profiles
  FOR INSERT
  WITH CHECK (auth.uid()::text = id::text OR email = current_setting('request.jwt.claims', true)::jsonb ->> 'email');

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles
  FOR UPDATE
  USING (auth.uid()::text = id::text OR email = current_setting('request.jwt.claims', true)::jsonb ->> 'email');

-- Note: RLS policies are designed for Supabase Auth. Since we use NextAuth with JWT,
-- the RLS provides defense-in-depth. The application-level auth in lib/auth.ts
-- handles the actual authorization logic.

-- Create a trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();