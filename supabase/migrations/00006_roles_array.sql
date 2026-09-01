-- Change the role column from a single TEXT to a TEXT[] array
-- to allow users to have both 'player' and 'team' roles.

-- Add a new temporary array column
ALTER TABLE profiles ADD COLUMN roles_temp TEXT[];

-- Migrate existing data: wrap single role values into arrays
UPDATE profiles SET roles_temp = CASE
  WHEN role IS NULL THEN NULL
  ELSE ARRAY[role]
END;

-- Drop the old column (this also drops the old CHECK constraint)
ALTER TABLE profiles DROP COLUMN role;

-- Rename the new column
ALTER TABLE profiles RENAME COLUMN roles_temp TO role;

-- Add a CHECK constraint to ensure only valid roles are stored
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IS NULL OR role <@ ARRAY['player', 'team']::TEXT[]);