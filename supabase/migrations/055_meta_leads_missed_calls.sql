-- Meta Lead Jobs: persistent missed-call counter + Archive list
-- missed_call_count never auto-resets (not nightly, not on successful contact) —
-- it only ever increments on "No Answer", and drives auto-archiving at 10.

alter table public.meta_leads add column if not exists missed_call_count integer not null default 0;

alter table public.meta_leads drop constraint if exists meta_leads_list_check;
alter table public.meta_leads add constraint meta_leads_list_check
  check (list in ('call_list','second_call_list','schedule_call_list','scheduled','archive'));
