-- ─── PropStream Work Mode ────────────────────────────────────────────────────
-- Adds need_follow_up status, phone-level call tracking, and lead conversion
-- fields required for the focused one-lead-at-a-time calling interface.

-- 1. Expand the status check constraint to include need_follow_up
--    Postgres inline CHECK constraints are auto-named <table>_<col>_check
alter table public.propstream_leads
  drop constraint if exists propstream_leads_status_check;

alter table public.propstream_leads
  add constraint propstream_leads_status_check
  check (status in (
    'new', 'called_no_answer', 'not_interested', 'warm_lead',
    'approved', 'converted', 'do_not_call', 'wrong_number',
    'callback_later', 'no_callable_phone', 'need_follow_up'
  ));

-- 2. Phone-level call tracking
--    Tracks per-phone attempt history so the work queue knows which
--    phones have already been fully handled and which still need work.
alter table public.propstream_lead_phones
  add column if not exists last_called_at  timestamptz,
  add column if not exists attempt_count   int  not null default 0,
  add column if not exists last_outcome    text,
  add column if not exists is_completed    boolean not null default false;

create index if not exists propstream_lead_phones_is_completed_idx
  on public.propstream_lead_phones(is_completed);

-- 3. Lead-level follow-up and CRM conversion tracking
alter table public.propstream_leads
  add column if not exists selected_follow_up_phone_id uuid
    references public.propstream_lead_phones(id) on delete set null,
  add column if not exists converted_customer_id uuid;
  -- Not FK to customers — avoids cross-schema dependency ordering issues.
  -- App layer validates on write.

-- 4. Seed the PropStream lead source so it is pre-selectable on conversion
insert into public.lead_sources (value, label, is_default, sort_order)
values ('propstream', 'PropStream', false, 99)
on conflict (value) do nothing;
