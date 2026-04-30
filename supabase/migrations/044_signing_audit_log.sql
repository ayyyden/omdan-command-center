-- Audit log for all customer-facing signing and approval actions

create table if not exists public.approval_audit_logs (
  id             uuid        primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  document_type  text        not null check (document_type in ('contract', 'estimate', 'change_order')),
  document_id    uuid        not null,
  token_hash     text        not null,   -- SHA-256 of raw signing/approval token (never store raw token)
  action         text        not null check (action in ('viewed', 'signed', 'approved', 'declined')),
  customer_name  text,
  customer_email text,
  ip_address     text,
  user_agent     text,
  metadata       jsonb                   -- e.g. { signer_name, contract_name, field_count }
);

alter table public.approval_audit_logs enable row level security;

-- Public pages (signing/approval flows) insert via service client — no RLS needed for service role.
-- Authenticated users can insert in case a helper runs in an authenticated context.
create policy "authenticated_insert_audit" on public.approval_audit_logs
  for insert to authenticated with check (true);

-- Only authenticated users can read (admin view). Page/API layer enforces owner/admin restriction.
create policy "authenticated_select_audit" on public.approval_audit_logs
  for select to authenticated using (true);

create index if not exists idx_audit_document
  on public.approval_audit_logs (document_type, document_id, created_at);
