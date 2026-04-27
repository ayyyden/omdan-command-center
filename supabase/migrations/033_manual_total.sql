-- Add manual_total override to jobs.
-- When set, this value is used instead of the calculated estimate + change-order total.
alter table public.jobs
  add column if not exists manual_total numeric(12,2);
