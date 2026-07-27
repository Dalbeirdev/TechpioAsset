/** Small display helpers shared across screens. */

interface NamedUser {
  email: string;
  profile: { firstName: string | null; lastName: string | null } | null;
}

/** A person's display name, falling back to their email. */
export function personName(user: NamedUser | null | undefined): string {
  if (!user) return 'Unknown';
  const full = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ').trim();
  return full || user.email;
}

/**
 * Format a decimal-string money amount with its currency. The API sends money as
 * exact decimal strings (Prisma Decimal), never floats, so we keep the string and
 * only add grouping — no parseFloat that could round a large amount.
 */
export function formatMoney(amount: string | null | undefined, currency: string): string {
  if (amount == null || amount === '') return '—';
  const negative = amount.startsWith('-');
  const [whole, fraction = ''] = amount.replace('-', '').split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = fraction.padEnd(2, '0').slice(0, 2);
  return `${negative ? '-' : ''}${currency} ${grouped}.${cents}`;
}
