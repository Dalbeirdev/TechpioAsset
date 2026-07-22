/**
 * Minimal 5-field cron next-run computation (spec section 18 scheduled reports).
 *
 * Supports the fields most schedules need: `*`, a single number, and step
 * values (`* / n`). Pure and testable; a full cron library would add a
 * dependency for functionality the spec's scheduled reports do not require.
 *
 * Fields: minute hour day-of-month month day-of-week.
 */

interface CronFields {
  minute: (n: number) => boolean;
  hour: (n: number) => boolean;
  dayOfMonth: (n: number) => boolean;
  month: (n: number) => boolean;
  dayOfWeek: (n: number) => boolean;
}

function matcher(field: string, min: number, max: number): (n: number) => boolean {
  if (field === '*') return () => true;

  const stepMatch = /^\*\/(\d+)$/.exec(field);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    return (n) => step > 0 && (n - min) % step === 0;
  }

  const listValues = field.split(',').map(Number);
  if (listValues.every((v) => Number.isInteger(v) && v >= min && v <= max)) {
    const set = new Set(listValues);
    return (n) => set.has(n);
  }

  // Unrecognised field never matches, which is safer than matching everything.
  return () => false;
}

export function parseCron(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    minute: matcher(minute, 0, 59),
    hour: matcher(hour, 0, 23),
    dayOfMonth: matcher(dayOfMonth, 1, 31),
    month: matcher(month, 1, 12),
    dayOfWeek: matcher(dayOfWeek, 0, 6),
  };
}

/**
 * Next time at or after `from` that the expression fires. Scans minute by minute
 * up to a year ahead; returns null for an invalid expression or if nothing
 * matches within the horizon.
 */
export function nextCronRun(expression: string, from: Date): Date | null {
  const fields = parseCron(expression);
  if (!fields) return null;

  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(from.getTime() + 366 * 86_400_000);
  while (candidate <= limit) {
    if (
      fields.minute(candidate.getMinutes()) &&
      fields.hour(candidate.getHours()) &&
      fields.dayOfMonth(candidate.getDate()) &&
      fields.month(candidate.getMonth() + 1) &&
      fields.dayOfWeek(candidate.getDay())
    ) {
      return new Date(candidate);
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}
