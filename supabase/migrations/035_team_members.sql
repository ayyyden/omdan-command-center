-- Team roles enum
do $$ begin
  if not exists (select 1 from pg_type where typname = 'team_role') then
    create type public.team_role as enum (
      'owner', 'admin', 'project_manager', 'office', 'field_worker', 'viewer'
    );
  end if;
end $$;

-- Member status enum
do $$ begin
  if not exists (select 1 from pg_type where typname = 'member_status') then
    create type public.member_status as enum ('invited', 'active', 'disabled');
  end if;
end $$;

-- Team members table
create table if not exists public.team_members (
  id                uuid             primary key default gen_random_uuid(),
  user_id           uuid             references auth.users(id) on delete set null,
  email             text             not null,
  name              text             not null,
  role              public.team_role      not null default 'viewer',
  status            public.member_status  not null default 'invited',
  invited_by        uuid             references auth.users(id) on delete set null,
  invite_token      text             unique,
  invite_expires_at timestamptz,
  created_at        timestamptz      not null default now(),
  updated_at        timestamptz      not null default now()
);

-- Unique: one row per linked user account
create unique index if not exists team_members_user_id_idx
  on public.team_members (user_id) where user_id is not null;

-- Unique: one row per email (case-insensitive)
create unique index if not exists team_members_email_idx
  on public.team_members (lower(email));

-- RLS: enable
alter table public.team_members enable row level security;

-- Any authenticated user can SELECT (needed to check own membership in layout)
drop policy if exists "team_members_select" on public.team_members;
create policy "team_members_select" on public.team_members
  for select to authenticated using (true);

-- All mutations go through API routes using the service role key (bypasses RLS)
-- No client-side insert/update/delete policies needed

-- updated_at trigger (reuse or create function)
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists team_members_updated_at on public.team_members;
create trigger team_members_updated_at
  before update on public.team_members
  for each row execute function public.handle_updated_at();
