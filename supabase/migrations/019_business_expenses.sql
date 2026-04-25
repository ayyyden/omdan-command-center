-- Add expense_type column, make job_id nullable, expand category enum

-- 1. Add expense_type with default 'job' so existing rows become job expenses
alter table public.expenses
  add column if not exists expense_type text not null default 'job'
  check (expense_type in ('job', 'business'));

-- 2. Make job_id optional (business expenses don't require a job)
alter table public.expenses
  alter column job_id drop not null;

-- 3. Replace the category check constraint with expanded list
alter table public.expenses
  drop constraint if exists expenses_category_check;

alter table public.expenses
  add constraint expenses_category_check
  check (category in (
    'labor','materials','subcontractors','permits','dump_fees','travel',
    'equipment','gas','vehicle','tools','office_rent','software',
    'insurance','marketing','meals','misc'
  ));

-- 4. Index for filtering by type
create index if not exists idx_expenses_type
  on public.expenses (user_id, expense_type);
