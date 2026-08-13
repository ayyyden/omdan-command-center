-- Consolidate expense categories — the screenshot-import feature (053)
-- introduced 'advertising' as a near-duplicate of the existing 'marketing'
-- category, plus 3 genuinely new ones (utilities, office_supplies,
-- professional_services) that the manual add-expense form and filter
-- dropdown never learned about. This merges the duplicate and re-applies
-- the constraint with a single, final list — no rows are deleted, existing
-- 'advertising' rows are relabeled to 'marketing' and keep all their data.

update public.expenses set category = 'marketing' where category = 'advertising';

alter table public.expenses
  drop constraint if exists expenses_category_check;

alter table public.expenses
  add constraint expenses_category_check
  check (category in (
    'materials','labor','subcontractors','permits','dump_fees',
    'equipment','gas','vehicle','tools','office_rent','software',
    'insurance','marketing','meals','travel',
    'utilities','office_supplies','professional_services',
    'misc'
  ));
