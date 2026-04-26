create table public.notification_dismissals (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  notification_key text        not null,
  dismissed_at     timestamptz not null default now(),
  unique (user_id, notification_key)
);

alter table public.notification_dismissals enable row level security;

create policy "Users manage own dismissals"
  on public.notification_dismissals for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create index idx_notification_dismissals_user
  on public.notification_dismissals (user_id);
