-- ─── Meta Lead Jobs workspace ───────────────────────────────────────────────
-- Facebook/Meta Lead Ads call-list workflow. Separate from propstream_leads
-- (different source, different semantics, different restricted role).

-- Add meta_lead to the team_role enum
alter type public.team_role add value if not exists 'meta_lead';

create table if not exists public.meta_leads (
  id                 uuid        primary key default gen_random_uuid(),
  created_by         uuid        references auth.users(id) on delete set null,
  full_name          text        not null,
  email              text,
  phone              text,
  city               text,
  address            text,
  raw_paste          text,
  list               text        not null default 'call_list'
    check (list in ('call_list','second_call_list','schedule_call_list','scheduled')),
  last_outcome       text,
  scheduled_at       timestamptz,
  calendar_event_id  text,
  calendar_id        text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists meta_leads_list_idx on public.meta_leads(list);

alter table public.meta_leads enable row level security;

drop policy if exists "meta_leads_select" on public.meta_leads;
create policy "meta_leads_select" on public.meta_leads
  for select to authenticated using (true);

drop policy if exists "meta_leads_insert" on public.meta_leads;
create policy "meta_leads_insert" on public.meta_leads
  for insert to authenticated with check (true);

drop policy if exists "meta_leads_update" on public.meta_leads;
create policy "meta_leads_update" on public.meta_leads
  for update to authenticated using (true) with check (true);

drop policy if exists "meta_leads_delete" on public.meta_leads;
create policy "meta_leads_delete" on public.meta_leads
  for delete to authenticated using (true);

drop trigger if exists meta_leads_updated_at on public.meta_leads;
create trigger meta_leads_updated_at
  before update on public.meta_leads
  for each row execute function public.handle_updated_at();
