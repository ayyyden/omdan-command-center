create table communication_logs (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  customer_id uuid        references customers(id) on delete set null,
  job_id      uuid        references jobs(id) on delete set null,
  estimate_id uuid        references estimates(id) on delete set null,
  template_id uuid        references message_templates(id) on delete set null,
  type        text        not null,
  subject     text,
  body        text        not null,
  channel     text        not null default 'manual_copy',
  created_at  timestamptz not null default now()
);

alter table communication_logs enable row level security;

create policy "users manage own communication_logs"
  on communication_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index communication_logs_user_id_idx      on communication_logs(user_id);
create index communication_logs_customer_id_idx  on communication_logs(customer_id);
create index communication_logs_job_id_idx       on communication_logs(job_id);
create index communication_logs_estimate_id_idx  on communication_logs(estimate_id);
create index communication_logs_created_at_idx   on communication_logs(created_at desc);
