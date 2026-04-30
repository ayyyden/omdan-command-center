create table if not exists estimate_payment_steps (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates(id) on delete cascade,
  name        text not null,
  amount      numeric(12,2) not null default 0,
  description text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table estimate_payment_steps enable row level security;

create policy "authenticated_manage_payment_steps"
  on estimate_payment_steps for all to authenticated
  using (true) with check (true);
