alter table public.reminders
  add column if not exists due_time time;
