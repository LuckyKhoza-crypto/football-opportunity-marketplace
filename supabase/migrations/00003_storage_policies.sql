-- Storage bucket must be created manually in Supabase dashboard:
-- 1. Go to Storage → Buckets → Create Bucket
-- 2. Name: player-profile-photos
-- 3. Set to Public
-- 4. Click Create
--
-- Then run these policies in the SQL Editor.

-- Allow players to upload their own photos
CREATE POLICY "Players can upload their own photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'player-profile-photos'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow anyone to view player photos
CREATE POLICY "Anyone can view player photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'player-profile-photos');

-- Allow players to update their own photos
CREATE POLICY "Players can update their own photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'player-profile-photos'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow players to delete their own photos
CREATE POLICY "Players can delete their own photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'player-profile-photos'
  AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::text
);