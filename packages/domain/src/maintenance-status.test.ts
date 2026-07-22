import { describe, it, expect } from 'vitest';
import { canTransition, isTerminal } from './state-machine';
import { MAINTENANCE_STATUSES, maintenanceStatusMachine } from './maintenance-status';

describe('maintenance status machine', () => {
  it('declares all six statuses (spec section 14)', () => {
    expect(MAINTENANCE_STATUSES).toHaveLength(6);
  });

  it('walks the standard schedule → start → complete path', () => {
    expect(canTransition(maintenanceStatusMachine, 'REQUESTED', 'SCHEDULED')).toBe(true);
    expect(canTransition(maintenanceStatusMachine, 'SCHEDULED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition(maintenanceStatusMachine, 'IN_PROGRESS', 'COMPLETED')).toBe(true);
  });

  it('allows a repair to fail from in-progress', () => {
    expect(canTransition(maintenanceStatusMachine, 'IN_PROGRESS', 'FAILED')).toBe(true);
  });

  it('cannot reopen a completed or cancelled record', () => {
    for (const status of MAINTENANCE_STATUSES) {
      expect(canTransition(maintenanceStatusMachine, 'COMPLETED', status)).toBe(
        status === 'COMPLETED',
      );
      expect(canTransition(maintenanceStatusMachine, 'CANCELLED', status)).toBe(
        status === 'CANCELLED',
      );
    }
  });

  it('cannot jump straight from requested to completed', () => {
    expect(canTransition(maintenanceStatusMachine, 'REQUESTED', 'COMPLETED')).toBe(false);
  });

  it('marks the terminal states', () => {
    expect(isTerminal(maintenanceStatusMachine, 'COMPLETED')).toBe(true);
    expect(isTerminal(maintenanceStatusMachine, 'FAILED')).toBe(true);
    expect(isTerminal(maintenanceStatusMachine, 'IN_PROGRESS')).toBe(false);
  });
});
