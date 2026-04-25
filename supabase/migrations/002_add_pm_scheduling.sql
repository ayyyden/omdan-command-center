-- Project Managers table
create table public.project_managers (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  is_active boolean not null default true
);

alter table public.project_managers enable row level security;

create policy "Users manage own project managers"
  on public.project_managers
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger set_updated_at_project_managers
  before update on public.project_managers
  for each row execute function public.handle_updated_at();

create index idx_project_managers_user_id on public.project_managers(user_id);
create index idx_project_managers_is_active on public.project_managers(is_active);

-- Add scheduling columns to jobs
alter table public.jobs
  add column project_manager_id uuid references public.project_managers(id) on delete set null,
  add column scheduled_time time;

create index idx_jobs_project_manager_id on public.jobs(project_manager_id);
