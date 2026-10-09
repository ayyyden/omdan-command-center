-- Meta Ads Advisor (phase 1): ad structure + daily insights from the Meta
-- Marketing API, lead → ad attribution, reports/actions from the advisor,
-- an alert queue (dedupe + quiet hours), settings, health checks, and a
-- real call-attempt log (missed_call_count only ever counted "No Answer").

-- ── Attribution on leads ────────────────────────────────────────────────────
alter table public.meta_leads
  add column if not exists meta_campaign_id text,
  add column if not exists meta_adset_id    text,
  add column if not exists meta_ad_id       text,
  add column if not exists meta_form_id     text,
  add column if not exists meta_leadgen_id  text,
  add column if not exists utm_source       text,
  add column if not exists utm_medium       text,
  add column if not exists utm_campaign     text,
  add column if not exists utm_content      text,
  add column if not exists utm_term         text,
  add column if not exists fbclid           text,
  add column if not exists attribution      text,
  add column if not exists attribution_note text,
  add column if not exists attributed_at    timestamptz;

alter table public.customers
  add column if not exists meta_campaign_id text,
  add column if not exists meta_adset_id    text,
  add column if not exists meta_ad_id       text,
  add column if not exists meta_form_id     text,
  add column if not exists utm_source       text,
  add column if not exists utm_medium       text,
  add column if not exists utm_campaign     text,
  add column if not exists utm_content      text,
  add column if not exists utm_term         text,
  add column if not exists fbclid           text,
  add column if not exists attribution      text,
  add column if not exists attributed_at    timestamptz,
  add column if not exists meta_lead_id     uuid references public.meta_leads(id) on delete set null;

alter table public.meta_leads drop constraint if exists meta_leads_attribution_check;
alter table public.meta_leads add constraint meta_leads_attribution_check
  check (attribution is null or attribution in ('leadgen', 'utm', 'unattributed'));
alter table public.customers drop constraint if exists customers_attribution_check;
alter table public.customers add constraint customers_attribution_check
  check (attribution is null or attribution in ('leadgen', 'utm', 'unattributed'));

create index if not exists meta_leads_meta_ad_idx       on public.meta_leads(meta_ad_id);
create index if not exists meta_leads_meta_campaign_idx on public.meta_leads(meta_campaign_id);
create index if not exists customers_meta_ad_idx        on public.customers(meta_ad_id);
create index if not exists customers_meta_lead_idx      on public.customers(meta_lead_id);

-- ── Call attempts (every outcome press + calls made in the Quo app) ────────
create table if not exists public.meta_lead_call_attempts (
  id            uuid primary key default gen_random_uuid(),
  meta_lead_id  uuid not null references public.meta_leads(id) on delete cascade,
  outcome       text,                 -- answered_scheduled | no_answer | callback_later | null (Quo call)
  source        text not null check (source in ('crm', 'lia', 'quo')),
  external_id   text,                 -- Quo call id, for dedupe
  answered      boolean,
  attempted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists meta_lead_call_attempts_lead_idx on public.meta_lead_call_attempts(meta_lead_id, attempted_at);
create unique index if not exists meta_lead_call_attempts_ext_idx on public.meta_lead_call_attempts(external_id) where external_id is not null;

-- ── Ad structure + daily insights ───────────────────────────────────────────
create table if not exists public.meta_ad_entities (
  id               text primary key,         -- Meta id
  level            text not null check (level in ('campaign', 'adset', 'ad')),
  campaign_id      text,
  adset_id         text,
  name             text not null,
  status           text,
  effective_status text,
  objective        text,
  daily_budget     numeric(12,2),
  lifetime_budget  numeric(12,2),
  learning_stage   text,
  thumbnail_url    text,
  form_id          text,
  -- 7-day reach/frequency straight from Meta (frequency isn't additive across days)
  reach_7d         integer,
  frequency_7d     numeric(8,3),
  created_time     timestamptz,
  first_seen_at    timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists meta_ad_entities_level_idx on public.meta_ad_entities(level);

create table if not exists public.meta_ad_insights_daily (
  entity_id      text not null,
  level          text not null check (level in ('campaign', 'adset', 'ad')),
  date           date not null,              -- in the ad account's timezone
  spend          numeric(12,2) not null default 0,
  impressions    integer not null default 0,
  reach          integer not null default 0,
  frequency      numeric(8,3),
  clicks         integer not null default 0,
  link_clicks    integer not null default 0,
  ctr            numeric(8,4),
  cpc            numeric(10,4),
  cpm            numeric(10,4),
  leads          integer not null default 0,
  video_3s_views integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (entity_id, date)
);
create index if not exists meta_ad_insights_daily_date_idx on public.meta_ad_insights_daily(level, date);

-- ── Advisor output ──────────────────────────────────────────────────────────
create table if not exists public.meta_ad_reports (
  id            uuid primary key default gen_random_uuid(),
  period        text not null check (period in ('daily', 'weekly', 'monthly')),
  period_start  date not null,
  period_end    date not null,
  summary       text,
  payload       jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists meta_ad_reports_period_idx on public.meta_ad_reports(period, period_start desc);

create table if not exists public.meta_ad_actions (
  id                uuid primary key default gen_random_uuid(),
  report_id         uuid references public.meta_ad_reports(id) on delete cascade,
  entity_id         text,
  entity_level      text,
  entity_name       text,
  type              text not null,
  text              text not null,
  reason            text,
  confidence        text check (confidence in ('low', 'medium', 'high')),
  urgency           text not null default 'normal' check (urgency in ('urgent', 'normal', 'low')),
  status            text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  done_at           timestamptz,
  metrics_at_done   jsonb,
  metrics_after_7d  jsonb,
  snapshot_due_at   timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists meta_ad_actions_status_idx on public.meta_ad_actions(status, created_at desc);
create index if not exists meta_ad_actions_snapshot_idx on public.meta_ad_actions(snapshot_due_at) where metrics_after_7d is null;

create table if not exists public.meta_ad_alerts (
  id          uuid primary key default gen_random_uuid(),
  key         text not null,                 -- rule + entity + LA date, for dedupe
  entity_id   text,
  severity    text not null check (severity in ('critical', 'urgent')),
  message     text not null,
  held_until  timestamptz,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists meta_ad_alerts_key_idx on public.meta_ad_alerts(key);

create table if not exists public.meta_ad_settings (
  id                          integer primary key default 1 check (id = 1),
  target_cpl                  numeric(10,2) not null default 40,
  target_cost_per_appointment numeric(10,2) not null default 150,
  avg_job_value               numeric(12,2) not null default 12000,
  appointment_maturity_days   integer not null default 7,
  sale_maturity_days          integer not null default 30,
  min_call_attempts           integer not null default 2,
  quiet_start_hour            integer not null default 21,
  quiet_end_hour              integer not null default 7,
  spend_no_lead_multiple      numeric(6,2) not null default 2.0,
  cpl_spike_multiple          numeric(6,2) not null default 2.0,
  frequency_limit             numeric(6,2) not null default 3.5,
  ctr_drop_pct                numeric(6,2) not null default 30,
  regions                     jsonb not null default '{}',
  updated_at                  timestamptz not null default now()
);
insert into public.meta_ad_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.meta_ad_health (
  id          uuid primary key default gen_random_uuid(),
  checked_at  timestamptz not null default now(),
  ok          boolean not null,
  account     jsonb,
  problems    jsonb not null default '[]'
);
create index if not exists meta_ad_health_checked_idx on public.meta_ad_health(checked_at desc);

-- ── RLS: owner/admin read via the app; all writes go through service-role routes
alter table public.meta_lead_call_attempts enable row level security;
alter table public.meta_ad_entities        enable row level security;
alter table public.meta_ad_insights_daily  enable row level security;
alter table public.meta_ad_reports         enable row level security;
alter table public.meta_ad_actions         enable row level security;
alter table public.meta_ad_alerts          enable row level security;
alter table public.meta_ad_settings        enable row level security;
alter table public.meta_ad_health          enable row level security;

drop policy if exists "meta_lead_call_attempts_read" on public.meta_lead_call_attempts;
create policy "meta_lead_call_attempts_read" on public.meta_lead_call_attempts for select to authenticated using (true);
drop policy if exists "meta_lead_call_attempts_insert" on public.meta_lead_call_attempts;
create policy "meta_lead_call_attempts_insert" on public.meta_lead_call_attempts for insert to authenticated with check (true);
