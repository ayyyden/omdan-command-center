-- ─── PropStream Lead Operating Center ───────────────────────────────────────
-- Tables: propstream_lists, propstream_leads, propstream_lead_phones,
--         propstream_call_logs, propstream_sms_logs

-- Import lists (one row per uploaded CSV)
create table if not exists public.propstream_lists (
  id             uuid        primary key default gen_random_uuid(),
  created_by     uuid        references auth.users(id) on delete set null,
  name           text        not null,
  filename       text        not null,
  row_count      int         not null default 0,
  imported_count int         not null default 0,
  callable_count int         not null default 0,
  no_phone_count int         not null default 0,
  dnc_removed    int         not null default 0,
  dupe_removed   int         not null default 0,
  skipped_count  int         not null default 0,
  created_at     timestamptz not null default now()
);

alter table public.propstream_lists enable row level security;
drop policy if exists "propstream_lists_select" on public.propstream_lists;
create policy "propstream_lists_select" on public.propstream_lists
  for select to authenticated using (true);

-- Individual property leads
create table if not exists public.propstream_leads (
  id                   uuid        primary key default gen_random_uuid(),
  list_id              uuid        not null references public.propstream_lists(id) on delete cascade,
  owner_name           text,
  owner2_name          text,
  property_address     text,
  property_city        text,
  property_state       text,
  property_zip         text,
  property_county      text,
  apn                  text,
  mailing_address      text,
  owner_occupied       boolean,
  property_type        text,
  bedrooms             int,
  bathrooms            numeric,
  sqft                 int,
  lot_sqft             int,
  year_built           int,
  assessed_value       numeric,
  last_sale_date       date,
  last_sale_amount     numeric,
  estimated_value      numeric,
  estimated_equity     numeric,
  estimated_ltv        numeric,
  open_loans_count     int,
  open_loans_balance   numeric,
  mls_status           text,
  mls_date             date,
  mls_amount           numeric,
  emails               text[]      not null default '{}',
  status               text        not null default 'new'
    check (status in ('new','called_no_answer','not_interested','warm_lead',
                      'approved','converted','do_not_call','wrong_number',
                      'callback_later','no_callable_phone')),
  next_follow_up_at    timestamptz,
  last_called_at       timestamptz,
  last_contacted_phone text,
  notes                text,
  raw_data             jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists propstream_leads_list_id_idx  on public.propstream_leads(list_id);
create index if not exists propstream_leads_status_idx   on public.propstream_leads(status);

alter table public.propstream_leads enable row level security;
drop policy if exists "propstream_leads_select" on public.propstream_leads;
create policy "propstream_leads_select" on public.propstream_leads
  for select to authenticated using (true);

drop trigger if exists propstream_leads_updated_at on public.propstream_leads;
create trigger propstream_leads_updated_at
  before update on public.propstream_leads
  for each row execute function public.handle_updated_at();

-- Phone numbers per lead (only non-DNC phones are stored here)
create table if not exists public.propstream_lead_phones (
  id              uuid        primary key default gen_random_uuid(),
  lead_id         uuid        not null references public.propstream_leads(id) on delete cascade,
  phone           text        not null,
  phone_type      text,
  is_active       boolean     not null default true,
  is_wrong_number boolean     not null default false,
  position        int         not null default 1,
  created_at      timestamptz not null default now()
);

create index if not exists propstream_lead_phones_lead_id_idx on public.propstream_lead_phones(lead_id);

alter table public.propstream_lead_phones enable row level security;
drop policy if exists "propstream_lead_phones_select" on public.propstream_lead_phones;
create policy "propstream_lead_phones_select" on public.propstream_lead_phones
  for select to authenticated using (true);

-- Call logs
create table if not exists public.propstream_call_logs (
  id               uuid        primary key default gen_random_uuid(),
  lead_id          uuid        not null references public.propstream_leads(id) on delete cascade,
  phone_id         uuid        references public.propstream_lead_phones(id) on delete set null,
  caller_user_id   uuid        references auth.users(id) on delete set null,
  to_phone         text        not null,
  from_phone       text,
  twilio_call_sid  text,
  status           text        not null default 'initiated',
  duration_seconds int,
  notes            text,
  outcome          text,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists propstream_call_logs_lead_id_idx on public.propstream_call_logs(lead_id);

alter table public.propstream_call_logs enable row level security;
drop policy if exists "propstream_call_logs_select" on public.propstream_call_logs;
create policy "propstream_call_logs_select" on public.propstream_call_logs
  for select to authenticated using (true);

-- SMS logs (outbound + inbound)
create table if not exists public.propstream_sms_logs (
  id                 uuid        primary key default gen_random_uuid(),
  lead_id            uuid        references public.propstream_leads(id) on delete cascade,
  phone_id           uuid        references public.propstream_lead_phones(id) on delete set null,
  call_log_id        uuid        references public.propstream_call_logs(id) on delete set null,
  direction          text        not null default 'outbound',
  to_phone           text        not null,
  from_phone         text,
  body               text        not null,
  twilio_message_sid text,
  status             text        not null default 'sent',
  is_auto            boolean     not null default false,
  created_at         timestamptz not null default now()
);

create index if not exists propstream_sms_logs_lead_id_idx on public.propstream_sms_logs(lead_id);
create index if not exists propstream_sms_logs_to_phone_idx on public.propstream_sms_logs(to_phone);

alter table public.propstream_sms_logs enable row level security;
drop policy if exists "propstream_sms_logs_select" on public.propstream_sms_logs;
create policy "propstream_sms_logs_select" on public.propstream_sms_logs
  for select to authenticated using (true);
