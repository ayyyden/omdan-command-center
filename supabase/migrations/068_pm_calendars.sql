-- ─── A Google Calendar per salesman ──────────────────────────────────────────
-- David's estimates live on the main calendar (the one the website booking
-- system reads for open times). Every other project manager gets his own
-- calendar, created by the CRM the first time an estimate is given to him and
-- shared with omdandevelopment@gmail.com (and his own email, if set).
-- Giving an estimate to him moves its event to his calendar, so David's time
-- opens up on the website and in Add lead.

alter table public.project_managers add column if not exists calendar_id   text;
alter table public.project_managers add column if not exists main_calendar boolean not null default false;

-- David uses the main calendar.
update public.project_managers set main_calendar = true where name ilike 'david%';
