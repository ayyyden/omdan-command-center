alter table public.activity_log
  add column if not exists job_id uuid references public.jobs(id) on delete cascade;

create index if not exists activity_log_job_id_idx on public.activity_log(job_id);
