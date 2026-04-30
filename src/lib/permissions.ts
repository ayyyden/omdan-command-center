export const ROLES = [
  'owner', 'admin', 'project_manager', 'office', 'field_worker', 'viewer',
] as const

export type TeamRole = typeof ROLES[number]

/** Roles that are currently active and have full app access. */
export const ACTIVE_ROLES: TeamRole[] = ['owner', 'admin', 'project_manager']

/** Roles that have been retired. Members with these roles are blocked until upgraded. */
export const LEGACY_ROLES: TeamRole[] = ['office', 'field_worker', 'viewer']

export function isLegacyRole(role: TeamRole | string): boolean {
  return LEGACY_ROLES.includes(role as TeamRole)
}

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner:           'Owner',
  admin:           'Admin',
  project_manager: 'Project Manager',
  office:          'Office',
  field_worker:    'Field Worker',
  viewer:          'Viewer',
}

export const ROLE_COLORS: Record<TeamRole, string> = {
  owner:           'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  admin:           'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  project_manager: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  office:          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  field_worker:    'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  viewer:          'bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300',
}

// Higher index = more power
const ROLE_POWER: Record<TeamRole, number> = {
  viewer: 0, field_worker: 1, project_manager: 2, office: 3, admin: 4, owner: 5,
}

export function roleAtLeast(role: TeamRole, minimum: TeamRole): boolean {
  return ROLE_POWER[role] >= ROLE_POWER[minimum]
}

/** Can `actor` manage (change role / disable / delete) a member whose current role is `target`? */
export function canManageRole(actor: TeamRole, target: TeamRole): boolean {
  if (actor === 'owner') return true
  if (actor === 'admin') return target !== 'owner'
  return false
}

/** Can `actor` invite someone into `targetRole`? Only active non-owner roles are invitable. */
export function canInviteRole(actor: TeamRole, targetRole: TeamRole): boolean {
  const invitable: TeamRole[] = ['admin', 'project_manager']
  if (!invitable.includes(targetRole)) return false
  if (actor === 'owner') return true
  if (actor === 'admin') return true
  return false
}

export function can(role: TeamRole, action: string): boolean {
  if (isLegacyRole(role)) return false
  switch (action) {
    // ── Team ─────────────────────────────────────────────────────────────────
    case 'team:view':
    case 'team:invite':
    case 'team:manage':
      return roleAtLeast(role, 'admin')
    case 'team:view_performance':
      return roleAtLeast(role, 'admin')

    // ── Settings ─────────────────────────────────────────────────────────────
    case 'settings:company':
      return role === 'owner'
    case 'settings:templates':
    case 'settings:project_managers':
      return roleAtLeast(role, 'admin')
    case 'settings:appearance':
      return true

    // ── Customers / Leads ────────────────────────────────────────────────────
    // Entire CRM/Leads pipeline is admin+ only — PM and below are redirected
    case 'customers:view':
    case 'customers:create':
    case 'customers:edit':
    case 'customers:delete':
    case 'customers:archive':
      return roleAtLeast(role, 'admin')

    // ── Estimates ────────────────────────────────────────────────────────────
    // Project Manager added: they create/manage estimates for their jobs
    case 'estimates:view':
    case 'estimates:create':
    case 'estimates:edit':
    case 'estimates:send':
      return role === 'project_manager' || roleAtLeast(role, 'office')
    case 'estimates:delete':
      return roleAtLeast(role, 'admin')

    // ── Jobs ─────────────────────────────────────────────────────────────────
    case 'jobs:view':
      return true
    // Financial data on job detail page (stat cards, invoices, payments, expenses, profit summary)
    case 'jobs:view_financials':
      return roleAtLeast(role, 'admin')
    case 'jobs:create':
      return roleAtLeast(role, 'office')
    case 'jobs:edit':
    case 'jobs:update_status':
      return role === 'project_manager' || role === 'field_worker' || roleAtLeast(role, 'office')
    case 'jobs:upload':
      return role === 'field_worker' || roleAtLeast(role, 'project_manager')
    case 'jobs:delete':
    case 'jobs:archive':
      return roleAtLeast(role, 'admin')

    // ── Payments / Finance ───────────────────────────────────────────────────
    // payments:view gates the company-wide /payments page — admin+ only
    case 'payments:view':
      return roleAtLeast(role, 'admin')
    // payments:create still allows office+ to record payments within a job
    case 'payments:create':
      return roleAtLeast(role, 'office')
    case 'payments:delete':
      return roleAtLeast(role, 'admin')

    // ── Expenses ─────────────────────────────────────────────────────────────
    // expenses:view gates the company-wide /expenses page — admin+ only
    case 'expenses:view':
      return roleAtLeast(role, 'admin')
    // expenses:create allows field workers/PMs to log job expenses in context
    case 'expenses:create':
      return role === 'field_worker' || roleAtLeast(role, 'project_manager')
    case 'expenses:delete':
      return roleAtLeast(role, 'admin')

    // ── Reports ──────────────────────────────────────────────────────────────
    case 'reports:view':
    case 'reports:export':
      return roleAtLeast(role, 'admin')

    // ── Dashboard financial widgets ───────────────────────────────────────────
    case 'dashboard:financials':
      return roleAtLeast(role, 'admin')

    // ── Contracts ────────────────────────────────────────────────────────────
    // ── Calculator ───────────────────────────────────────────────────────────────
    case 'calculator:view':
      return role === 'project_manager' || roleAtLeast(role, 'admin')

    case 'contracts:view':
    case 'contracts:send':
      return roleAtLeast(role, 'office')
    case 'contracts:delete':
      return roleAtLeast(role, 'admin')

    // ── Change Orders ────────────────────────────────────────────────────────
    case 'change_orders:view':
    case 'change_orders:create':
      return role === 'project_manager' || roleAtLeast(role, 'office')
    case 'change_orders:delete':
      return roleAtLeast(role, 'admin')

    // ── Files ────────────────────────────────────────────────────────────────
    case 'files:view':
      return true
    case 'files:upload':
      return role === 'field_worker' || roleAtLeast(role, 'project_manager')
    case 'files:delete':
      return roleAtLeast(role, 'admin')

    // ── Scheduler ────────────────────────────────────────────────────────────
    case 'scheduler:view':
      return true
    case 'scheduler:edit':
      return roleAtLeast(role, 'office')

    default:
      return false
  }
}
