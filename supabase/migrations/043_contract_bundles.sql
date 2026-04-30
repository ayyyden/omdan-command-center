-- Contract bundles: one signing token, multiple contracts in sequence

create table if not exists public.contract_bundles (
  id            uuid primary key default gen_random_uuid(),
  signing_token uuid not null default gen_random_uuid() unique,
  user_id       uuid not null references auth.users(id) on delete cascade,
  customer_id   uuid references public.customers(id) on delete set null,
  job_id        uuid references public.jobs(id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table public.contract_bundles enable row level security;

create policy "authenticated_select_bundles" on public.contract_bundles
  for select to authenticated using (true);
create policy "authenticated_insert_bundles" on public.contract_bundles
  for insert to authenticated with check (true);
-- Public/anon can read bundles (needed for signing page)
create policy "anon_select_bundles" on public.contract_bundles
  for select to anon using (true);

-- Add bundle linkage to sent_contracts
alter table public.sent_contracts
  add column if not exists bundle_id         uuid references public.contract_bundles(id) on delete cascade,
  add column if not exists bundle_sort_order integer;

create index if not exists idx_sent_contracts_bundle
  on public.sent_contracts (bundle_id, bundle_sort_order);
