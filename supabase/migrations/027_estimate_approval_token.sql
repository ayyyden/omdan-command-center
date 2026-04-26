alter table public.estimates
  add column if not exists approval_token uuid not null default gen_random_uuid();

create unique index if not exists estimates_approval_token_key
  on public.estimates (approval_token);
