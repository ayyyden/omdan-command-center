create sequence if not exists invoice_number_seq start with 1000 increment by 1;

alter table invoices
  add column if not exists invoice_number text unique,
  add column if not exists payment_methods text[] not null default array['zelle','cash','check'];

create or replace function set_invoice_number()
returns trigger language plpgsql as $$
begin
  if new.invoice_number is null then
    new.invoice_number :=
      'OMD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoice_number on invoices;
create trigger trg_invoice_number
  before insert on invoices
  for each row execute function set_invoice_number();
