import { describe, it, expect } from 'vitest';
import { canTransition, isTerminal } from './state-machine';
import { MAINTENANCE_STATUSES, maintenanceStatusMachine } from './maintenance-status';

describe('maintenance status machine', () => {
  it('declares all seven statuses (spec section 14 + v2.5 ON_HOLD)', () => {
    expect(MAINTENANCE_STATUSES).toHaveLength(7);
  });

  it('holds and resumes only from in-progress (v2.5 work orders)', () => {
    expect(canTransition(maintenanceStatusMachine, 'IN_PROGRESS', 'ON_HOLD')).toBe(true);
    expect(canTransition(maintenanceStatusMachine, 'ON_HOLD', 'IN_PROGRESS')).toBe(true);
    expect(canTransition(maintenanceStatusMachine, 'ON_HOLD', 'CANCELLED')).toBe(true);
    // Held work cannot complete unseen, and unstarted work cannot be held.
    expect(canTransition(maintenanceStatusMachine, 'ON_HOLD', 'COMPLETED')).toBe(false);
    expect(canTransition(maintenanceStatusMachine, 'SCHEDULED', 'ON_HOLD')).toBe(false);
    expect(canTransition(maintenanceStatusMachine, 'REQUESTED', 'ON_HOLD')).toBe(false);
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
