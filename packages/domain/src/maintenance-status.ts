import type { StateMachine } from './state-machine';

/** Maintenance record lifecycle (spec section 14 + v2.5 work orders). */
export const MAINTENANCE_STATUSES = [
  'REQUESTED',
  'SCHEDULED',
  'IN_PROGRESS',
  'ON_HOLD',
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
    // v2.5: a technician can pause work (waiting on a part, on the user, on a
    // vendor). Held work resumes or is abandoned - it cannot complete unseen.
    IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'FAILED', 'CANCELLED'],
    ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
    FAILED: [],
  },
};

/** Statuses that mean the asset is currently out of service. */
export const MAINTENANCE_ACTIVE_STATUSES: readonly MaintenanceStatus[] = [
  'SCHEDULED',
  'IN_PROGRESS',
  'ON_HOLD',
];
