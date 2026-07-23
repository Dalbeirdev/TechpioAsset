/**
 * Permission catalogue and the system role matrix (PLAN.md section 4, spec section 3).
 *
 * Permissions are the atom; roles are named bags of them. Nothing in the codebase
 * may branch on a role name - guards check `assets:assign`, never
 * `role === 'IT_ADMIN'` - because spec section 3 requires roles and their grants
 * to be reconfigurable at runtime by a Super Admin.
 */

export const PERMISSIONS = {
  // Assets
  ASSETS_READ: 'assets:read',
  ASSETS_CREATE: 'assets:create',
  ASSETS_UPDATE: 'assets:update',
  ASSETS_IMPORT: 'assets:import',
  ASSETS_ASSIGN: 'assets:assign',
  ASSETS_RETURN: 'assets:return',
  ASSETS_TRANSFER: 'assets:transfer',
  ASSETS_DISPOSE: 'assets:dispose',
  ASSETS_COST_READ: 'assets:cost:read',

  // Quantity-tracked stock
  INVENTORY_READ: 'inventory:read',
  INVENTORY_ADJUST: 'inventory:adjust',

  // Invoices and procurement
  INVOICES_READ: 'invoices:read',
  INVOICES_UPLOAD: 'invoices:upload',
  INVOICES_CORRECT_EXTRACTION: 'invoices:correct-extraction',
  INVOICES_VERIFY: 'invoices:verify',
  VENDORS_READ: 'vendors:read',
  VENDORS_MANAGE: 'vendors:manage',
  PURCHASE_ORDERS_READ: 'purchase-orders:read',
  PURCHASE_ORDERS_MANAGE: 'purchase-orders:manage',

  // Requests and workflow
  REQUESTS_CREATE: 'requests:create',
  REQUESTS_CREATE_ON_BEHALF: 'requests:create-on-behalf',
  REQUESTS_READ: 'requests:read',
  REQUESTS_APPROVE: 'requests:approve',
  REQUESTS_CANCEL: 'requests:cancel',

  // People
  EMPLOYEES_READ: 'employees:read',
  EMPLOYEES_CREATE: 'employees:create',
  EMPLOYEES_IMPORT: 'employees:import',
  ONBOARDING_MANAGE: 'onboarding:manage',
  ONBOARDING_FULFIL: 'onboarding:fulfil',
  OFFBOARDING_MANAGE: 'offboarding:manage',
  OFFBOARDING_FULFIL: 'offboarding:fulfil',

  // Lifecycle
  MAINTENANCE_READ: 'maintenance:read',
  MAINTENANCE_REQUEST: 'maintenance:request',
  MAINTENANCE_MANAGE: 'maintenance:manage',

  // Reporting
  REPORTS_READ: 'reports:read',
  REPORTS_EXPORT: 'reports:export',

  // Administration
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
  ROLES_MANAGE: 'roles:manage',
  PERMISSIONS_MANAGE: 'permissions:manage',
  CATEGORIES_MANAGE: 'categories:manage',
  WORKFLOWS_CONFIGURE: 'workflows:configure',
  SETTINGS_MANAGE: 'settings:manage',

  // AI
  AI_CONFIGURE: 'ai:configure',
  AI_REVIEW_RESULTS: 'ai:review-results',

  // Audit and labelling
  AUDIT_READ: 'audit:read',
  QR_GENERATE: 'qr:generate',
  QR_PRINT: 'qr:print',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/**
 * How much of a resource a grant reaches. Enforced in the repository layer, not
 * the controller, so it holds for reports and exports too - not merely for the
 * screens someone remembered to guard.
 */
export const DATA_SCOPES = ['ALL', 'DEPARTMENT', 'DIRECT_REPORTS', 'OWN'] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

export const SYSTEM_ROLES = [
  'SUPER_ADMIN',
  'IT_ADMIN',
  'HR',
  'OFFICE_ADMIN',
  'FINANCE',
  'MANAGER',
  'EMPLOYEE',
  'AUDITOR',
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

const P = PERMISSIONS;

/** Actions that only read. Used to prove the Auditor role can never mutate. */
const WRITE_ACTION_PATTERN =
  /:(create|update|delete|assign|return|transfer|dispose|adjust|upload|verify|approve|cancel|manage|configure|import|correct-extraction|generate|print|fulfil|request|create-on-behalf)$/;

export function isReadOnlyPermission(permission: Permission): boolean {
  return !WRITE_ACTION_PATTERN.test(permission);
}

export const ROLE_PERMISSIONS: Readonly<Record<SystemRole, readonly Permission[]>> = {
  SUPER_ADMIN: ALL_PERMISSIONS,

  IT_ADMIN: [
    P.ASSETS_READ,
    P.ASSETS_CREATE,
    P.ASSETS_UPDATE,
    P.ASSETS_IMPORT,
    P.ASSETS_ASSIGN,
    P.ASSETS_RETURN,
    P.ASSETS_TRANSFER,
    P.ASSETS_COST_READ,
    P.INVENTORY_READ,
    P.INVENTORY_ADJUST,
    // Invoice capture ("scan a bill") is Finance + Super Admin only; IT keeps
    // read-only visibility because assets link to their purchase invoices.
    P.INVOICES_READ,
    P.VENDORS_READ,
    P.PURCHASE_ORDERS_READ,
    P.REQUESTS_CREATE,
    P.REQUESTS_READ,
    P.REQUESTS_APPROVE,
    P.EMPLOYEES_READ,
    P.ONBOARDING_FULFIL,
    P.OFFBOARDING_FULFIL,
    P.MAINTENANCE_READ,
    P.MAINTENANCE_MANAGE,
    P.REPORTS_READ,
    P.REPORTS_EXPORT,
    P.AUDIT_READ,
    P.QR_GENERATE,
    P.QR_PRINT,
  ],

  // Spec section 3: "HR must not see financial invoice details unless a specific
  // financial-view permission is granted." ASSETS_COST_READ and INVOICES_READ are
  // therefore deliberately absent and must be granted individually.
  HR: [
    P.ASSETS_READ,
    P.REQUESTS_CREATE,
    P.REQUESTS_CREATE_ON_BEHALF,
    P.REQUESTS_READ,
    P.REQUESTS_APPROVE,
    P.EMPLOYEES_READ,
    P.EMPLOYEES_CREATE,
    P.EMPLOYEES_IMPORT,
    P.ONBOARDING_MANAGE,
    P.OFFBOARDING_MANAGE,
    P.REPORTS_READ,
    P.REPORTS_EXPORT,
  ],

  OFFICE_ADMIN: [
    P.ASSETS_READ,
    P.ASSETS_CREATE,
    P.ASSETS_UPDATE,
    P.ASSETS_ASSIGN,
    P.ASSETS_RETURN,
    P.ASSETS_TRANSFER,
    P.ASSETS_COST_READ,
    P.INVENTORY_READ,
    P.INVENTORY_ADJUST,
    // Invoice capture ("scan a bill") is Finance + Super Admin only.
    P.VENDORS_READ,
    P.PURCHASE_ORDERS_READ,
    P.REQUESTS_CREATE,
    P.REQUESTS_READ,
    P.REQUESTS_APPROVE,
    P.EMPLOYEES_READ,
    P.ONBOARDING_FULFIL,
    P.OFFBOARDING_FULFIL,
    P.MAINTENANCE_READ,
    P.MAINTENANCE_MANAGE,
    P.REPORTS_READ,
    P.REPORTS_EXPORT,
    P.QR_GENERATE,
    P.QR_PRINT,
  ],

  FINANCE: [
    P.ASSETS_READ,
    P.ASSETS_COST_READ,
    P.INVENTORY_READ,
    P.INVOICES_READ,
    P.INVOICES_UPLOAD,
    P.INVOICES_CORRECT_EXTRACTION,
    P.INVOICES_VERIFY,
    P.VENDORS_READ,
    P.VENDORS_MANAGE,
    P.PURCHASE_ORDERS_READ,
    P.PURCHASE_ORDERS_MANAGE,
    P.REQUESTS_CREATE,
    P.REQUESTS_READ,
    P.REQUESTS_APPROVE,
    P.REPORTS_READ,
    P.REPORTS_EXPORT,
    P.AI_REVIEW_RESULTS,
    P.AUDIT_READ,
  ],

  MANAGER: [
    P.ASSETS_READ,
    P.REQUESTS_CREATE,
    P.REQUESTS_READ,
    P.REQUESTS_APPROVE,
    P.EMPLOYEES_READ,
    P.REPORTS_READ,
  ],

  EMPLOYEE: [
    P.ASSETS_READ,
    P.REQUESTS_CREATE,
    P.REQUESTS_READ,
    P.REQUESTS_CANCEL,
    P.MAINTENANCE_REQUEST,
  ],

  AUDITOR: [
    P.ASSETS_READ,
    P.ASSETS_COST_READ,
    P.INVENTORY_READ,
    P.INVOICES_READ,
    P.VENDORS_READ,
    P.PURCHASE_ORDERS_READ,
    P.REQUESTS_READ,
    P.EMPLOYEES_READ,
    P.MAINTENANCE_READ,
    P.REPORTS_READ,
    P.REPORTS_EXPORT,
    P.USERS_READ,
    P.AUDIT_READ,
  ],
};

/**
 * Default read scope per role. A role holding `assets:read` still only sees what
 * its scope allows; EMPLOYEE is pinned to OWN, which is what makes spec section 3's
 * "Employees must not see other employees' assets" structural rather than advisory.
 */
export const ROLE_DEFAULT_SCOPE: Readonly<Record<SystemRole, DataScope>> = {
  SUPER_ADMIN: 'ALL',
  IT_ADMIN: 'ALL',
  HR: 'ALL',
  OFFICE_ADMIN: 'ALL',
  FINANCE: 'ALL',
  MANAGER: 'DIRECT_REPORTS',
  EMPLOYEE: 'OWN',
  AUDITOR: 'ALL',
};

/**
 * Roles that may never be granted a write permission, whatever an administrator
 * later configures. Spec section 3: the Auditor has "No create, edit, assignment,
 * approval, or deletion permission."
 */
export const READ_ONLY_ROLES: readonly SystemRole[] = ['AUDITOR'];

export class ReadOnlyRoleViolationError extends Error {
  constructor(role: SystemRole, permission: Permission) {
    super(`Role ${role} is read-only and may not be granted ${permission}`);
    this.name = 'ReadOnlyRoleViolationError';
  }
}

export function assertGrantAllowed(role: SystemRole, permission: Permission): void {
  if (READ_ONLY_ROLES.includes(role) && !isReadOnlyPermission(permission)) {
    throw new ReadOnlyRoleViolationError(role, permission);
  }
}

export function roleHasPermission(role: SystemRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Union of every permission across a user's roles. */
export function resolvePermissions(roles: readonly SystemRole[]): ReadonlySet<Permission> {
  const resolved = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) resolved.add(permission);
  }
  return resolved;
}

/** Narrowest scope wins when a user holds several roles. */
export function resolveScope(roles: readonly SystemRole[]): DataScope {
  const precedence: readonly DataScope[] = ['OWN', 'DIRECT_REPORTS', 'DEPARTMENT', 'ALL'];
  let widest: DataScope = 'OWN';
  for (const role of roles) {
    const scope = ROLE_DEFAULT_SCOPE[role];
    if (precedence.indexOf(scope) > precedence.indexOf(widest)) widest = scope;
  }
  return widest;
}
