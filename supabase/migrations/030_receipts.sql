create table public.receipts (
  id         uuid          primary key default gen_random_uuid(),
  user_id    uuid          not null references auth.users(id) on delete cascade,
  job_id     uuid          references public.jobs(id) on delete set null,
  expense_id uuid          references public.expenses(id) on delete set null,
  file_path  text          not null unique,
  amount     numeric(12,2),
  note       text,
  created_at timestamptz   not null default now()
);

alter table public.receipts enable row level security;

create policy "Users manage own receipts"
  on public.receipts for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create index idx_receipts_user_id on public.receipts (user_id);
create index idx_receipts_job_id  on public.receipts (job_id) where job_id is not null;
