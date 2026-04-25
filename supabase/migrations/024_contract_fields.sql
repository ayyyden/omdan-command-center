create table public.contract_fields (
  id                   uuid        primary key default gen_random_uuid(),
  contract_template_id uuid        not null references public.contract_templates(id) on delete cascade,
  page_number          integer     not null default 1,
  field_type           text        not null check (field_type in (
    'text', 'multiline', 'date', 'signature', 'initials', 'checkbox', 'yes_no'
  )),
  label                text        not null,
  x                    float       not null,
  y                    float       not null,
  width                float       not null,
  height               float       not null,
  required             boolean     not null default false,
  options              jsonb,
  created_at           timestamptz not null default now()
);

create index idx_contract_fields_template on public.contract_fields (contract_template_id);
alter table public.contract_fields enable row level security;
create policy "Users manage own contract_fields"
  on public.contract_fields for all to authenticated
  using  ((select user_id from public.contract_templates where id = contract_template_id) = auth.uid())
  with check ((select user_id from public.contract_templates where id = contract_template_id) = auth.uid());
