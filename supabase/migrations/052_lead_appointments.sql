-- ─── Lead Appointments ───────────────────────────────────────────────────────
-- Stores partner lead appointments (separate from jobs).
-- Linked to customers; no job_id required.

create table if not exists public.lead_appointments (
  id                uuid        primary key default gen_random_uuid(),
  customer_id       uuid        references public.customers(id) on delete set null,
  user_id           uuid        not null references auth.users(id) on delete cascade,
  scheduled_date    date        not null,
  start_time        time,
  end_time          time,
  status            text        not null default 'scheduled'
                    check (status in ('scheduled','visited','estimate_needed','estimate_sent','no_show','cancelled','converted')),
  assigned_pm_id    uuid        references public.project_managers(id) on delete set null,
  source            text,
  partner_reference text,
  project_summary   text,
  notes             text,
  raw_text          text,
  category_code     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists on_lead_appointments_updated on public.lead_appointments;
create trigger on_lead_appointments_updated
  before update on public.lead_appointments
  for each row execute procedure public.handle_updated_at();

create index if not exists idx_lead_appointments_date     on public.lead_appointments(scheduled_date);
create index if not exists idx_lead_appointments_customer on public.lead_appointments(customer_id);
create index if not exists idx_lead_appointments_user     on public.lead_appointments(user_id);

alter table public.lead_appointments enable row level security;

drop policy if exists "lead_appts_select" on public.lead_appointments;
create policy "lead_appts_select" on public.lead_appointments
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "lead_appts_insert" on public.lead_appointments;
create policy "lead_appts_insert" on public.lead_appointments
  for insert to authenticated with check (auth.uid() is not null);

drop policy if exists "lead_appts_update" on public.lead_appointments;
create policy "lead_appts_update" on public.lead_appointments
  for update to authenticated using (auth.uid() is not null);
