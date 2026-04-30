-- Drop the hardcoded CHECK constraint so custom lead sources can be stored
alter table customers drop constraint if exists customers_lead_source_check;

-- Soft-delete support: archived sources are hidden from dropdowns but existing records are untouched
alter table lead_sources add column if not exists archived_at timestamptz;

-- Allow authenticated users to delete non-default lead sources
-- (authorization is enforced at the API layer via requirePermission)
create policy "authenticated_delete_lead_sources"
  on lead_sources for delete to authenticated
  using (is_default = false);

-- Allow updates (for archiving via archived_at)
create policy "authenticated_update_lead_sources"
  on lead_sources for update to authenticated
  using (is_default = false);
