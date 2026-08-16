-- Some blanks on a contract belong to the salesperson, not the customer
-- (Sales Person Signature, State Registration Number, and pages like the
-- Continuation/Addendum that are entirely the contractor's side with no
-- customer signature at all). fill_role marks who's responsible for a
-- field; staff-owned fields are collected in a short "Prepare" step before
-- the customer ever sees the consent/fill screens, and are never shown to
-- or required from the customer.

alter table public.contract_fields
  add column if not exists fill_role text not null default 'customer'
  check (fill_role in ('customer', 'staff'));

-- Staff-entered values, captured at Prepare time (before a customer ever
-- opens the signing link) and merged with the customer's own fieldValues
-- at final stamping time in /api/contracts/sign/[token].
alter table public.sent_contracts
  add column if not exists staff_field_values jsonb;
