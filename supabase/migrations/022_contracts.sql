-- Contract templates library
create table public.contract_templates (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  name         text        not null,
  description  text,
  storage_path text        not null,
  bucket       text        not null default 'files',
  file_name    text        not null,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now()
);

create index idx_contract_templates_user on public.contract_templates (user_id);
alter table public.contract_templates enable row level security;
create policy "Users manage own contract_templates"
  on public.contract_templates for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Sent contracts audit trail
create table public.sent_contracts (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null references auth.users(id) on delete cascade,
  contract_template_id uuid        not null references public.contract_templates(id) on delete cascade,
  customer_id          uuid        not null references public.customers(id) on delete cascade,
  job_id               uuid        references public.jobs(id) on delete set null,
  recipient_email      text        not null,
  subject              text,
  body                 text,
  status               text        not null default 'sent',
  sent_at              timestamptz not null default now()
);

create index idx_sent_contracts_user     on public.sent_contracts (user_id);
create index idx_sent_contracts_customer on public.sent_contracts (customer_id);
alter table public.sent_contracts enable row level security;
create policy "Users manage own sent_contracts"
  on public.sent_contracts for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Fix file_attachments unique constraint so the same storage file can be
-- linked to multiple entities (e.g. a contract sent to a customer AND a job).
-- The original constraint was unique(bucket, storage_path).
alter table public.file_attachments
  drop constraint if exists file_attachments_bucket_storage_path_key;

alter table public.file_attachments
  add constraint file_attachments_unique_per_entity
  unique (bucket, storage_path, entity_type, entity_id);
