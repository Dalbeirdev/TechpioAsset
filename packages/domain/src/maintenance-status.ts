import type { StateMachine } from './state-machine';

/** Maintenance record lifecycle (spec section 14). Mirrors the schema enum. */
export const MAINTENANCE_STATUSES = [
  'REQUESTED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const maintenanceStatusMachine: StateMachine<MaintenanceStatus> = {
  name: 'MaintenanceStatus',
  initial: 'REQUESTED',
  terminal: ['COMPLETED', 'CANCELLED', 'FAILED'],
  transitions: {
    REQUESTED: ['SCHEDULED', 'IN_PROGRESS', 'CANCELLED'],
    // A scheduled job can start, be rescheduled (self, handled by canTransition),
    // or be cancelled before it begins.
    SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'FAILED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
    FAILED: [],
  },
};

/** Statuses that mean the asset is currently out of service. */
export const MAINTENANCE_ACTIVE_STATUSES: readonly MaintenanceStatus[] = [
  'SCHEDULED',
  'IN_PROGRESS',
];
