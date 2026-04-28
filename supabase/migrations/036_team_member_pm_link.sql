-- Link a team member to a project_managers row.
-- When role is project_manager or field_worker, job filtering uses this ID.
alter table public.team_members
  add column if not exists project_manager_id uuid
  references public.project_managers(id) on delete set null;
