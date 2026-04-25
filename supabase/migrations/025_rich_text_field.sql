-- Add rich_text to the allowed field types
alter table public.contract_fields
  drop constraint if exists contract_fields_field_type_check;

alter table public.contract_fields
  add constraint contract_fields_field_type_check
    check (field_type in (
      'text', 'multiline', 'date',
      'signature', 'initials',
      'checkbox', 'yes_no',
      'rich_text'
    ));
