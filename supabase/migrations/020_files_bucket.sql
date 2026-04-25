-- Create private "files" bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'files',
  'files',
  false,
  52428800, -- 50 MB per file
  array[
    'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain','text/csv'
  ]
)
on conflict (id) do nothing;

-- Authenticated users can upload to their own folder ({user_id}/...)
create policy "Users can upload own files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'files'
    and (string_to_array(name, '/'))[1] = auth.uid()::text
  );

-- Users can read their own files
create policy "Users can read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'files'
    and (string_to_array(name, '/'))[1] = auth.uid()::text
  );

-- Users can delete their own files
create policy "Users can delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'files'
    and (string_to_array(name, '/'))[1] = auth.uid()::text
  );
