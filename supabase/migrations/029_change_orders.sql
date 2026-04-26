create table public.change_orders (
  id             uuid          primary key default gen_random_uuid(),
  user_id        uuid          not null references auth.users(id) on delete cascade,
  job_id         uuid          not null references public.jobs(id) on delete cascade,
  customer_id    uuid          not null references public.customers(id) on delete cascade,
  title          text          not null,
  description    text,
  amount         numeric(12,2) not null default 0,
  notes          text,
  status         text          not null default 'draft'
                               check (status in ('draft','sent','approved','rejected')),
  approval_token uuid          not null default gen_random_uuid(),
  approved_at    timestamptz,
  rejected_at    timestamptz,
  sent_at        timestamptz,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now()
);

alter table public.change_orders enable row level security;

create policy "Users manage own change orders"
  on public.change_orders for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create unique index change_orders_approval_token_key
  on public.change_orders (approval_token);

create index idx_change_orders_job_id
  on public.change_orders (job_id);

create trigger set_updated_at_change_orders
  before update on public.change_orders
  for each row execute procedure public.set_updated_at();
