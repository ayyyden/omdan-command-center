-- Tracks the linked Google Calendar event per job / lead appointment, so the
-- Scheduler page's replacement (an embedded Google Calendar) has everything
-- in one place — mirrors the calendar_event_id/calendar_id pattern already
-- used on meta_leads.

alter table public.jobs
  add column if not exists calendar_event_id text,
  add column if not exists calendar_id       text;

alter table public.lead_appointments
  add column if not exists calendar_event_id text,
  add column if not exists calendar_id       text;
