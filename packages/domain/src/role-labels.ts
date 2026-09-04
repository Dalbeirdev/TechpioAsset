import type { SystemRole } from './permissions';

/** Display metadata for the 13 system roles - one source for seed and tenant provisioning (v2.6 A4). */
export const ROLE_LABELS: Record<SystemRole, { name: string; description: string }> = {
  SUPER_ADMIN: { name: 'Super Admin', description: 'Full system access.' },
  IT_ADMIN: {
    name: 'IT Administrator',
    description: 'Manages IT equipment, assignments, warranties and device lifecycle.',
  },
  HR: {
    name: 'HR',
    description:
      'Manages employees, onboarding and offboarding. No financial invoice access unless granted.',
  },
  OFFICE_ADMIN: {
    name: 'Office Administrator',
    description: 'Manages furniture, kitchen equipment, pantry stock and office supplies.',
  },
  FINANCE: {
    name: 'Finance',
    description: 'Reviews costs, verifies invoices, approves purchases and tracks vendor spend.',
  },
  MANAGER: {
    name: 'Manager',
    description: 'Reviews and approves requests raised by direct reports.',
  },
  EMPLOYEE: {
    name: 'Registered Employee',
    description: 'Views own assets, raises requests, reports damage and submits returns.',
  },
  AUDITOR: {
    name: 'Auditor',
    description: 'Read-only access to assets, invoices, approvals, audit logs and reports.',
  },
  // v2.1 Workstream C — the five net-new canonical roles (blueprint §1).
  COMPANY_ADMIN: {
    name: 'Company Admin',
    description: 'Tenant owner: users, roles, workflows and configuration for this company.',
  },
  IT_TECHNICIAN: {
    name: 'IT Technician',
    description: 'Executes IT work — deploy, assign, repair and maintain devices.',
  },
  PROCUREMENT_MANAGER: {
    name: 'Procurement Manager',
    description: 'Manages vendors, purchase orders and sourcing; approves requests.',
  },
  INVENTORY_MANAGER: {
    name: 'Inventory Manager',
    description: 'Manages stock, receiving, transfers and asset provisioning.',
  },
  VENDOR: {
    name: 'Vendor',
    description: 'External supplier. Manages only its own catalogue, orders and invoices.',
  },
};
