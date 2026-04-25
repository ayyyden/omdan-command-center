alter table public.jobs
  add column if not exists is_archived boolean not null default false;

alter table public.customers
  add column if not exists is_archived boolean not null default false;

alter table public.project_managers
  add column if not exists is_archived boolean not null default false;

create index if not exists jobs_archived_idx on public.jobs(user_id, is_archived);
create index if not exists customers_archived_idx on public.customers(user_id, is_archived);
create index if not exists pms_archived_idx on public.project_managers(user_id, is_archived);
