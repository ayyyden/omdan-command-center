-- Add color to project managers (hex string, default gray)
alter table public.project_managers
  add column color text not null default '#6B7280';
