-- Custom invoice types table
create table if not exists invoice_types (
  id          uuid primary key default gen_random_uuid(),
  value       text not null unique,
  label       text not null,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Seed built-in types
insert into invoice_types (value, label, is_default) values
  ('deposit',  'Deposit',  true),
  ('progress', 'Progress', true),
  ('final',    'Final',    true)
on conflict (value) do nothing;

-- Drop the hardcoded CHECK constraint so custom invoice types can be stored
-- The auto-generated name for the inline CHECK on invoices.type is invoices_type_check
alter table invoices drop constraint if exists invoices_type_check;

-- RLS
alter table invoice_types enable row level security;

create policy "authenticated_read_invoice_types"
  on invoice_types for select to authenticated using (true);

create policy "authenticated_insert_invoice_types"
  on invoice_types for insert to authenticated with check (true);

create policy "authenticated_update_invoice_types"
  on invoice_types for update to authenticated using (is_default = false);

create policy "authenticated_delete_invoice_types"
  on invoice_types for delete to authenticated using (is_default = false);
