create table if not exists lead_sources (
  id         uuid primary key default gen_random_uuid(),
  value      text not null unique,
  label      text not null,
  is_default boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

insert into lead_sources (value, label, is_default, sort_order) values
  ('referral',         'Referral',         true, 1),
  ('google',           'Google',           true, 2),
  ('facebook',         'Facebook',         true, 3),
  ('instagram',        'Instagram',        true, 4),
  ('door_knock',       'Door Knock',       true, 5),
  ('repeat_customer',  'Repeat Customer',  true, 6),
  ('yard_sign',        'Yard Sign',        true, 7),
  ('nextdoor',         'Nextdoor',         true, 8),
  ('yelp',             'Yelp',             true, 9),
  ('other',            'Other',            true, 10)
on conflict (value) do nothing;

alter table lead_sources enable row level security;

create policy "authenticated_read_lead_sources"
  on lead_sources for select to authenticated using (true);

create policy "authenticated_insert_lead_sources"
  on lead_sources for insert to authenticated with check (true);
