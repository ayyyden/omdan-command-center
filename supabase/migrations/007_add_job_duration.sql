alter table public.jobs
  add column if not exists estimated_duration_minutes integer not null default 120;
