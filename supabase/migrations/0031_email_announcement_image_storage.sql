-- FOM-EMAIL-ANNOUNCEMENTS-001: public Storage bucket for announcement images.
--
-- Announcement emails embed an uploaded image with a plain <img src="https://…">
-- pointing at a PUBLIC object URL, so it renders in common email clients (Gmail
-- included). The bucket must therefore be public.
--
-- The image is uploaded ONLY by the admin-only server route
-- (`POST /api/admin/email-announcements/image`) using the service-role client.
-- No client INSERT/UPDATE/DELETE policy exists, so anon/authenticated users can
-- never upload, replace or delete an announcement image.
--
-- MANUAL STEP: create the bucket in the Supabase dashboard if you prefer:
--   Storage → Buckets → Create Bucket
--     Name:   email-announcement-images
--     Public: yes
-- The SQL below performs the same creation idempotently and adds the read policy.

INSERT INTO storage.buckets (id, name, public)
VALUES ('email-announcement-images', 'email-announcement-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read, so recipients' email clients can load the image.
DROP POLICY IF EXISTS "Anyone can view announcement images" ON storage.objects;

CREATE POLICY "Anyone can view announcement images"
ON storage.objects FOR SELECT
USING (bucket_id = 'email-announcement-images');
