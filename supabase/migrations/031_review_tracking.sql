-- Add review tracking columns to jobs
alter table public.jobs
  add column if not exists review_requested_at timestamptz,
  add column if not exists review_completed     boolean not null default false;
