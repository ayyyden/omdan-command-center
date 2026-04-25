-- Add signing fields to sent_contracts
alter table public.sent_contracts
  add column if not exists signing_token uuid unique not null default gen_random_uuid(),
  add column if not exists signed_at      timestamptz,
  add column if not exists signer_name    text,
  add column if not exists signed_pdf_path text;

create index if not exists idx_sent_contracts_token
  on public.sent_contracts (signing_token);
