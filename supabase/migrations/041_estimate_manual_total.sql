-- Add manual total price override to estimates.
-- When set, this value is used as the estimate total instead of the calculated line-item sum.
alter table public.estimates
  add column if not exists manual_total_price numeric(12,2);
