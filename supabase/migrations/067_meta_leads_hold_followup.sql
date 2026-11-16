-- ─── Lead lists: On Hold + Follow-up ────────────────────────────────────────
-- Two quiet lists on the Leads page. Nothing texts or calls a lead on them:
--   on_hold    the customer asked to wait (no date)
--   follow_up  check back with them on follow_up_at (a reminder for the team only)
-- list_note is why it's there ("waiting on insurance", "call after the holidays").

alter table public.meta_leads drop constraint if exists meta_leads_list_check;
alter table public.meta_leads add constraint meta_leads_list_check
  check (list in ('call_list','second_call_list','schedule_call_list','scheduled','archive','on_hold','follow_up'));

alter table public.meta_leads add column if not exists follow_up_at timestamptz;
alter table public.meta_leads add column if not exists list_note    text;

create index if not exists meta_leads_follow_up_idx on public.meta_leads(follow_up_at) where list = 'follow_up';
