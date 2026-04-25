-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- CUSTOMERS (covers both leads and customers in one table)
-- ============================================================
create table public.customers (
  id          uuid primary key default uuid_generate_v4(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  phone       text,
  email       text,
  address     text,
  service_type text,
  lead_source text check (lead_source in ('referral','google','facebook','instagram','door_knock','repeat_customer','yard_sign','nextdoor','other')),
  status      text not null default 'New Lead' check (status in (
    'New Lead','Contacted','Estimate Sent','Follow-Up Needed',
    'Approved','Scheduled','In Progress','Completed','Paid','Closed Lost'
  )),
  notes       text
);

-- ============================================================
-- ESTIMATES
-- ============================================================
create table public.estimates (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  title           text not null,
  scope_of_work   text,
  line_items      jsonb not null default '[]',
  markup_percent  numeric(5,2) not null default 0,
  tax_percent     numeric(5,2) not null default 0,
  subtotal        numeric(12,2) not null default 0,
  markup_amount   numeric(12,2) not null default 0,
  tax_amount      numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  status          text not null default 'draft' check (status in ('draft','sent','approved','rejected')),
  notes           text,
  sent_at         timestamptz,
  approved_at     timestamptz
);

-- ============================================================
-- JOBS
-- ============================================================
create table public.jobs (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  estimate_id     uuid references public.estimates(id) on delete set null,
  title           text not null,
  description     text,
  status          text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','on_hold','cancelled')),
  scheduled_date  date,
  completion_date date,
  notes           text
);

-- ============================================================
-- EXPENSES
-- ============================================================
create table public.expenses (
  id          uuid primary key default uuid_generate_v4(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  category    text not null check (category in ('labor','materials','subcontractors','permits','dump_fees','travel','equipment','misc')),
  description text not null,
  amount      numeric(12,2) not null,
  date        date not null default current_date,
  receipt_url text,
  notes       text
);

-- ============================================================
-- PAYMENTS
-- ============================================================
create table public.payments (
  id          uuid primary key default uuid_generate_v4(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      uuid not null references public.jobs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  amount      numeric(12,2) not null,
  method      text not null check (method in ('cash','check','zelle','venmo','credit_card','bank_transfer','other')),
  date        date not null default current_date,
  notes       text
);

-- ============================================================
-- REMINDERS
-- ============================================================
create table public.reminders (
  id           uuid primary key default uuid_generate_v4(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  customer_id  uuid references public.customers(id) on delete cascade,
  job_id       uuid references public.jobs(id) on delete cascade,
  type         text not null check (type in ('estimate_follow_up','payment_reminder','material_reminder','review_request','custom')),
  title        text not null,
  due_date     date not null,
  completed_at timestamptz,
  notes        text
);

-- ============================================================
-- ACTIVITY LOG
-- ============================================================
create table public.activity_log (
  id          uuid primary key default uuid_generate_v4(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('customer','estimate','job','expense','payment','reminder')),
  entity_id   uuid not null,
  action      text not null,
  description text not null
);

-- ============================================================
-- ROW LEVEL SECURITY — users only see their own data
-- ============================================================
alter table public.customers    enable row level security;
alter table public.estimates    enable row level security;
alter table public.jobs         enable row level security;
alter table public.expenses     enable row level security;
alter table public.payments     enable row level security;
alter table public.reminders    enable row level security;
alter table public.activity_log enable row level security;

-- Customers
create policy "customers_select" on public.customers for select using (auth.uid() = user_id);
create policy "customers_insert" on public.customers for insert with check (auth.uid() = user_id);
create policy "customers_update" on public.customers for update using (auth.uid() = user_id);
create policy "customers_delete" on public.customers for delete using (auth.uid() = user_id);

-- Estimates
create policy "estimates_select" on public.estimates for select using (auth.uid() = user_id);
create policy "estimates_insert" on public.estimates for insert with check (auth.uid() = user_id);
create policy "estimates_update" on public.estimates for update using (auth.uid() = user_id);
create policy "estimates_delete" on public.estimates for delete using (auth.uid() = user_id);

-- Jobs
create policy "jobs_select" on public.jobs for select using (auth.uid() = user_id);
create policy "jobs_insert" on public.jobs for insert with check (auth.uid() = user_id);
create policy "jobs_update" on public.jobs for update using (auth.uid() = user_id);
create policy "jobs_delete" on public.jobs for delete using (auth.uid() = user_id);

-- Expenses
create policy "expenses_select" on public.expenses for select using (auth.uid() = user_id);
create policy "expenses_insert" on public.expenses for insert with check (auth.uid() = user_id);
create policy "expenses_update" on public.expenses for update using (auth.uid() = user_id);
create policy "expenses_delete" on public.expenses for delete using (auth.uid() = user_id);

-- Payments
create policy "payments_select" on public.payments for select using (auth.uid() = user_id);
create policy "payments_insert" on public.payments for insert with check (auth.uid() = user_id);
create policy "payments_update" on public.payments for update using (auth.uid() = user_id);
create policy "payments_delete" on public.payments for delete using (auth.uid() = user_id);

-- Reminders
create policy "reminders_select" on public.reminders for select using (auth.uid() = user_id);
create policy "reminders_insert" on public.reminders for insert with check (auth.uid() = user_id);
create policy "reminders_update" on public.reminders for update using (auth.uid() = user_id);
create policy "reminders_delete" on public.reminders for delete using (auth.uid() = user_id);

-- Activity log
create policy "activity_log_select" on public.activity_log for select using (auth.uid() = user_id);
create policy "activity_log_insert" on public.activity_log for insert with check (auth.uid() = user_id);

-- ============================================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_customers_updated    before update on public.customers    for each row execute procedure public.handle_updated_at();
create trigger on_estimates_updated    before update on public.estimates    for each row execute procedure public.handle_updated_at();
create trigger on_jobs_updated         before update on public.jobs         for each row execute procedure public.handle_updated_at();
create trigger on_expenses_updated     before update on public.expenses     for each row execute procedure public.handle_updated_at();
create trigger on_payments_updated     before update on public.payments     for each row execute procedure public.handle_updated_at();
create trigger on_reminders_updated    before update on public.reminders    for each row execute procedure public.handle_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================
create index customers_user_id_idx    on public.customers(user_id);
create index customers_status_idx     on public.customers(status);
create index estimates_customer_id_idx on public.estimates(customer_id);
create index estimates_user_id_idx    on public.estimates(user_id);
create index jobs_customer_id_idx     on public.jobs(customer_id);
create index jobs_scheduled_date_idx  on public.jobs(scheduled_date);
create index expenses_job_id_idx      on public.expenses(job_id);
create index payments_job_id_idx      on public.payments(job_id);
create index reminders_due_date_idx   on public.reminders(due_date);
create index reminders_user_id_idx    on public.reminders(user_id);
create index activity_log_entity_idx  on public.activity_log(entity_type, entity_id);
