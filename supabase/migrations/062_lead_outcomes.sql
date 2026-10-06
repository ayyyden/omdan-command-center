-- Lead outcomes ("How it went") + leads created from confirmed calendar appointments.
--
-- lead_outcome: what happened with the lead after the appointment.
--   NPG / PNS / OTHER → lead moves to the Canceled list (status 'Closed Lost')
--   SOLD              → lead moves on to 'Approved'
-- calendar_event_id: the Google Calendar appointment a lead was created from
--   when it was confirmed on the Calendar page (prevents duplicates).

alter table public.customers
  add column if not exists lead_outcome      text,
  add column if not exists lead_outcome_at   timestamptz,
  add column if not exists calendar_event_id text;

alter table public.customers drop constraint if exists customers_lead_outcome_check;
alter table public.customers add constraint customers_lead_outcome_check
  check (lead_outcome is null or lead_outcome in ('NPG', 'PNS', 'OTHER', 'SOLD'));

create index if not exists customers_calendar_event_idx on public.customers(calendar_event_id);
create index if not exists customers_lead_outcome_idx   on public.customers(lead_outcome);

-- Leads booked on the website (desertgreenbuilders.com) get their own source.
-- Sources are managed in the lead_sources table (Settings), which already
-- holds custom values (ross_meta, propstream, meta) that the original
-- hard-coded check constraint never allowed — so drop that stale constraint.
alter table public.customers drop constraint if exists customers_lead_source_check;

insert into public.lead_sources (value, label, is_default, sort_order)
values ('website', 'Website', true, 11)
on conflict (value) do nothing;
