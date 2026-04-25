-- Storage RLS policies for the "documents" bucket.
-- Run this AFTER creating the bucket in the Supabase dashboard.

-- Authenticated users can upload new files
create policy "Authenticated users can upload to documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documents');

-- File owner can overwrite (UPDATE) their own files
create policy "Owners can update documents"
  on storage.objects for update to authenticated
  using  (bucket_id = 'documents' and owner = auth.uid())
  with check (bucket_id = 'documents');

-- File owner can delete their own files
create policy "Owners can delete documents"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and owner = auth.uid());

-- Anyone (including unauthenticated) can read — matches "public bucket" intent.
-- If you want to restrict to authenticated only, change USING to:
--   (bucket_id = 'documents') and add TO authenticated
create policy "Public can read documents"
  on storage.objects for select
  using (bucket_id = 'documents');
