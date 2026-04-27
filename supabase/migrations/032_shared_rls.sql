-- Replace per-user RLS policies with team-wide authenticated access.
-- All authenticated users now share the same data.

-- ── CUSTOMERS ────────────────────────────────────────────────────────────────
drop policy if exists "customers_select" on public.customers;
drop policy if exists "customers_insert" on public.customers;
drop policy if exists "customers_update" on public.customers;
drop policy if exists "customers_delete" on public.customers;

create policy "customers_select" on public.customers for select to authenticated using (true);
create policy "customers_insert" on public.customers for insert to authenticated with check (true);
create policy "customers_update" on public.customers for update to authenticated using (true) with check (true);
create policy "customers_delete" on public.customers for delete to authenticated using (true);

-- ── ESTIMATES ────────────────────────────────────────────────────────────────
drop policy if exists "estimates_select" on public.estimates;
drop policy if exists "estimates_insert" on public.estimates;
drop policy if exists "estimates_update" on public.estimates;
drop policy if exists "estimates_delete" on public.estimates;

create policy "estimates_select" on public.estimates for select to authenticated using (true);
create policy "estimates_insert" on public.estimates for insert to authenticated with check (true);
create policy "estimates_update" on public.estimates for update to authenticated using (true) with check (true);
create policy "estimates_delete" on public.estimates for delete to authenticated using (true);

-- ── JOBS ─────────────────────────────────────────────────────────────────────
drop policy if exists "jobs_select" on public.jobs;
drop policy if exists "jobs_insert" on public.jobs;
drop policy if exists "jobs_update" on public.jobs;
drop policy if exists "jobs_delete" on public.jobs;

create policy "jobs_select" on public.jobs for select to authenticated using (true);
create policy "jobs_insert" on public.jobs for insert to authenticated with check (true);
create policy "jobs_update" on public.jobs for update to authenticated using (true) with check (true);
create policy "jobs_delete" on public.jobs for delete to authenticated using (true);

-- ── EXPENSES ─────────────────────────────────────────────────────────────────
drop policy if exists "expenses_select" on public.expenses;
drop policy if exists "expenses_insert" on public.expenses;
drop policy if exists "expenses_update" on public.expenses;
drop policy if exists "expenses_delete" on public.expenses;

create policy "expenses_select" on public.expenses for select to authenticated using (true);
create policy "expenses_insert" on public.expenses for insert to authenticated with check (true);
create policy "expenses_update" on public.expenses for update to authenticated using (true) with check (true);
create policy "expenses_delete" on public.expenses for delete to authenticated using (true);

-- ── PAYMENTS ─────────────────────────────────────────────────────────────────
drop policy if exists "payments_select" on public.payments;
drop policy if exists "payments_insert" on public.payments;
drop policy if exists "payments_update" on public.payments;
drop policy if exists "payments_delete" on public.payments;

create policy "payments_select" on public.payments for select to authenticated using (true);
create policy "payments_insert" on public.payments for insert to authenticated with check (true);
create policy "payments_update" on public.payments for update to authenticated using (true) with check (true);
create policy "payments_delete" on public.payments for delete to authenticated using (true);

-- ── REMINDERS ────────────────────────────────────────────────────────────────
drop policy if exists "reminders_select" on public.reminders;
drop policy if exists "reminders_insert" on public.reminders;
drop policy if exists "reminders_update" on public.reminders;
drop policy if exists "reminders_delete" on public.reminders;

create policy "reminders_select" on public.reminders for select to authenticated using (true);
create policy "reminders_insert" on public.reminders for insert to authenticated with check (true);
create policy "reminders_update" on public.reminders for update to authenticated using (true) with check (true);
create policy "reminders_delete" on public.reminders for delete to authenticated using (true);

-- ── ACTIVITY LOG ─────────────────────────────────────────────────────────────
drop policy if exists "activity_log_select" on public.activity_log;
drop policy if exists "activity_log_insert" on public.activity_log;

create policy "activity_log_select" on public.activity_log for select to authenticated using (true);
create policy "activity_log_insert" on public.activity_log for insert to authenticated with check (true);

-- ── PROJECT MANAGERS ─────────────────────────────────────────────────────────
drop policy if exists "Users manage own project managers" on public.project_managers;

create policy "project_managers_access" on public.project_managers for all to authenticated
  using (true) with check (true);

-- ── INVOICES ─────────────────────────────────────────────────────────────────
drop policy if exists "Users manage own invoices" on public.invoices;

create policy "invoices_access" on public.invoices for all to authenticated
  using (true) with check (true);

-- ── COMPANY SETTINGS ─────────────────────────────────────────────────────────
drop policy if exists "Users manage own company settings" on public.company_settings;

create policy "company_settings_access" on public.company_settings for all to authenticated
  using (true) with check (true);

-- ── MESSAGE TEMPLATES ────────────────────────────────────────────────────────
drop policy if exists "Users manage own templates" on public.message_templates;

create policy "message_templates_access" on public.message_templates for all to authenticated
  using (true) with check (true);

-- ── COMMUNICATION LOGS ───────────────────────────────────────────────────────
drop policy if exists "users manage own communication_logs" on public.communication_logs;

create policy "communication_logs_access" on public.communication_logs for all to authenticated
  using (true) with check (true);

-- ── FILE ATTACHMENTS ─────────────────────────────────────────────────────────
drop policy if exists "Users manage own file_attachments" on public.file_attachments;

create policy "file_attachments_access" on public.file_attachments for all to authenticated
  using (true) with check (true);

-- ── CONTRACT TEMPLATES ───────────────────────────────────────────────────────
drop policy if exists "Users manage own contract_templates" on public.contract_templates;

create policy "contract_templates_access" on public.contract_templates for all to authenticated
  using (true) with check (true);

-- ── SENT CONTRACTS ───────────────────────────────────────────────────────────
drop policy if exists "Users manage own sent_contracts" on public.sent_contracts;

create policy "sent_contracts_access" on public.sent_contracts for all to authenticated
  using (true) with check (true);

-- ── CONTRACT FIELDS ──────────────────────────────────────────────────────────
drop policy if exists "Users manage own contract_fields" on public.contract_fields;

create policy "contract_fields_access" on public.contract_fields for all to authenticated
  using (true) with check (true);

-- ── NOTIFICATION DISMISSALS ──────────────────────────────────────────────────
-- Keep per-user insert/update but allow all users to read all dismissals so
-- dismissed notifications are hidden team-wide.
drop policy if exists "Users manage own dismissals" on public.notification_dismissals;

create policy "notification_dismissals_select" on public.notification_dismissals
  for select to authenticated using (true);
create policy "notification_dismissals_insert" on public.notification_dismissals
  for insert to authenticated with check (true);
create policy "notification_dismissals_delete" on public.notification_dismissals
  for delete to authenticated using (true);

-- ── CHANGE ORDERS ────────────────────────────────────────────────────────────
drop policy if exists "Users manage own change orders" on public.change_orders;

create policy "change_orders_access" on public.change_orders for all to authenticated
  using (true) with check (true);

-- ── RECEIPTS ─────────────────────────────────────────────────────────────────
drop policy if exists "Users manage own receipts" on public.receipts;

create policy "receipts_access" on public.receipts for all to authenticated
  using (true) with check (true);

-- ── STORAGE: files bucket — allow all authenticated users to read/write ───────
drop policy if exists "Users can upload own files"  on storage.objects;
drop policy if exists "Users can read own files"    on storage.objects;
drop policy if exists "Users can delete own files"  on storage.objects;

create policy "authenticated_upload_files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'files');

create policy "authenticated_read_files" on storage.objects
  for select to authenticated
  using (bucket_id = 'files');

create policy "authenticated_delete_files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'files');

-- ── STORAGE: documents bucket — open update/delete to all authenticated ───────
drop policy if exists "Owners can update documents" on storage.objects;
drop policy if exists "Owners can delete documents" on storage.objects;

create policy "authenticated_update_documents" on storage.objects
  for update to authenticated
  using  (bucket_id = 'documents')
  with check (bucket_id = 'documents');

create policy "authenticated_delete_documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents');
