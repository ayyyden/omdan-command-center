-- ─── Appointment confirmations (AI phone receptionist) ──────────────────────
-- One row per scheduled estimate (meta lead + its start time). The confirm
-- cron (/api/retell/confirm-cron) walks each appointment through:
--   morning appointments (before 12 PM):  call the day before at 6 PM
--   afternoon appointments (12 PM on):     call the same day at 10 AM
--   no answer -> confirmation text (reply YES / 2)
--   still not confirmed -> last call 30 minutes before
-- A reschedule creates a new row for the new time (the old one becomes
-- 'rescheduled'), so a moved appointment starts fresh.

create table if not exists public.appointment_confirmations (
  id                 uuid        primary key default gen_random_uuid(),
  meta_lead_id       uuid        not null references public.meta_leads(id) on delete cascade,
  scheduled_at       timestamptz not null,
  brand              text        not null default 'omdan' check (brand in ('omdan','desert_green')),
  status             text        not null default 'pending'
    check (status in ('pending','confirmed','rescheduled','cancelled')),
  first_call_at      timestamptz,
  first_call_id      text,
  first_call_result  text,
  text_sent_at       timestamptz,
  final_call_at      timestamptz,
  final_call_id      text,
  final_call_result  text,
  confirmed_at       timestamptz,
  confirmed_via      text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (meta_lead_id, scheduled_at)
);

create index if not exists appointment_confirmations_scheduled_idx on public.appointment_confirmations(scheduled_at);

alter table public.appointment_confirmations enable row level security;

drop policy if exists "appointment_confirmations_select" on public.appointment_confirmations;
create policy "appointment_confirmations_select" on public.appointment_confirmations
  for select to authenticated using (true);

drop trigger if exists appointment_confirmations_updated_at on public.appointment_confirmations;
create trigger appointment_confirmations_updated_at
  before update on public.appointment_confirmations
  for each row execute function public.handle_updated_at();
