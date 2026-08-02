import { MAINTENANCE_ACTIVE_STATUSES, type MaintenanceStatus } from './maintenance-status';

/**
 * v2.5 work-order rules (plan section H3).
 *
 * SLA escalation mirrors the approvals pattern: an overdue, still-active work
 * order escalates EXACTLY ONCE - escalatedAt is both the flag and the record
 * of when. Preventive schedules advance strictly into the future so a sweep
 * that was down for a month spawns one catch-up order, not thirty.
 */

export interface EscalatableWorkOrder {
  status: MaintenanceStatus;
  slaDueAt: Date | null;
  escalatedAt: Date | null;
}

/** True when the sweep should escalate this order now (and only now). */
export function shouldEscalateWorkOrder(order: EscalatableWorkOrder, now: Date): boolean {
  if (order.escalatedAt !== null) return false; // escalate once
  if (order.slaDueAt === null) return false; // no SLA agreed
  if (!MAINTENANCE_ACTIVE_STATUSES.includes(order.status)) return false;
  return order.slaDueAt.getTime() < now.getTime();
}

/**
 * The next due date after a spawn: advances by whole intervals until strictly
 * in the future. A schedule the sweep missed for weeks catches up with ONE
 * spawned order and a future due date, never a backlog of stale orders.
 */
export function advanceSchedule(nextDueAt: Date, intervalDays: number, now: Date): Date {
  if (intervalDays < 1 || !Number.isInteger(intervalDays)) {
    throw new Error(`intervalDays must be a positive integer, got ${intervalDays}`);
  }
  const interval = intervalDays * 86_400_000;
  let next = nextDueAt.getTime();
  while (next <= now.getTime()) next += interval;
  return new Date(next);
}
