alter table public.estimates
  add column if not exists declined_at timestamptz;
