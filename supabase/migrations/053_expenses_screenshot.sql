-- Add card_last4 and source columns; expand category constraint for screenshot imports

alter table public.expenses
  add column if not exists card_last4 text,
  add column if not exists source     text;

-- Expand category constraint to include more business expense types
alter table public.expenses
  drop constraint if exists expenses_category_check;

alter table public.expenses
  add constraint expenses_category_check
  check (category in (
    'labor','materials','subcontractors','permits','dump_fees','travel',
    'equipment','gas','vehicle','tools','office_rent','software',
    'insurance','marketing','meals','misc',
    'utilities','office_supplies','advertising','professional_services'
  ));

create index if not exists idx_expenses_source
  on public.expenses (user_id, source)
  where source is not null;
