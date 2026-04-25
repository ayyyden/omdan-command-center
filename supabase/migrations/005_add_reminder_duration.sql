alter table public.reminders
  add column if not exists duration_minutes integer not null default 30;
