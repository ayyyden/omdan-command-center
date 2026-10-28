-- ─── Evening lead check-in + text follow-ups ────────────────────────────────
-- lead_checkins: at 8 PM Lia asks David how each of that day's estimates went
--   (one row per estimate; his answer is logged through Lia's
--   log_lead_outcomes action and marks the row done).
-- lead_followups: leads tagged for follow-up get short casual texts from their
--   company's Quo number on day 2, 5, 10, 21, 51 and 81. Any reply from the
--   customer stops it and tells David.

create table if not exists public.lead_checkins (
  id            uuid        primary key default gen_random_uuid(),
  checkin_date  date        not null,
  meta_lead_id  uuid        not null references public.meta_leads(id) on delete cascade,
  position      integer     not null,
  status        text        not null default 'pending' check (status in ('pending','done')),
  outcome       text,
  outcome_note  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (checkin_date, meta_lead_id)
);
create index if not exists lead_checkins_status_idx on public.lead_checkins(status, checkin_date);

create table if not exists public.lead_followups (
  id            uuid        primary key default gen_random_uuid(),
  meta_lead_id  uuid        references public.meta_leads(id) on delete set null,
  customer_id   uuid        references public.customers(id) on delete set null,
  full_name     text        not null,
  phone         text        not null,
  brand         text        not null default 'omdan' check (brand in ('omdan','desert_green')),
  language      text        not null default 'en' check (language in ('en','es')),
  job           text,
  reason        text        not null default 'no_sale' check (reason in ('no_sale','no_show')),
  step          integer     not null default 0,
  next_at       timestamptz,
  status        text        not null default 'active' check (status in ('active','replied','stopped','done')),
  last_sent_at  timestamptz,
  last_reply    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists lead_followups_due_idx on public.lead_followups(status, next_at);
create index if not exists lead_followups_phone_idx on public.lead_followups(phone);

alter table public.lead_checkins  enable row level security;
alter table public.lead_followups enable row level security;

drop policy if exists "lead_checkins_select" on public.lead_checkins;
create policy "lead_checkins_select" on public.lead_checkins for select to authenticated using (true);
drop policy if exists "lead_followups_select" on public.lead_followups;
create policy "lead_followups_select" on public.lead_followups for select to authenticated using (true);
drop policy if exists "lead_followups_update" on public.lead_followups;
create policy "lead_followups_update" on public.lead_followups for update to authenticated using (true) with check (true);

drop trigger if exists lead_checkins_updated_at on public.lead_checkins;
create trigger lead_checkins_updated_at before update on public.lead_checkins
  for each row execute function public.handle_updated_at();
drop trigger if exists lead_followups_updated_at on public.lead_followups;
create trigger lead_followups_updated_at before update on public.lead_followups
  for each row execute function public.handle_updated_at();
