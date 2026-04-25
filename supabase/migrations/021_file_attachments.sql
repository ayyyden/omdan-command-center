-- Tracks metadata for all uploaded files (both 'files' and 'documents' buckets)
create table public.file_attachments (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  bucket       text        not null default 'files',
  storage_path text        not null,
  file_name    text        not null,
  category     text        not null default 'other'
    check (category in (
      'photos','progress_photos','receipts','payment_checks',
      'contracts','signed_contracts','permits','pdfs','other'
    )),
  entity_type  text        not null check (entity_type in ('jobs','customers','estimates')),
  entity_id    uuid        not null,
  size_bytes   bigint      default 0,
  mime_type    text,
  created_at   timestamptz not null default now(),

  unique (bucket, storage_path)
);

create index idx_file_attachments_entity
  on public.file_attachments (user_id, entity_type, entity_id);

alter table public.file_attachments enable row level security;

create policy "Users manage own file_attachments"
  on public.file_attachments for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
