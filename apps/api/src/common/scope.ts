import type { Prisma } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';

/**
 * Data-scope filters.
 *
 * Spec section 3: "Employees must not see other employees' assets, requests,
 * invoices, or costs." These functions produce Prisma `where` fragments that
 * every list and read path composes in, so isolation is a property of the query
 * layer rather than something each controller has to remember. That matters
 * because the endpoints most likely to leak - reports and exports - are exactly
 * the ones where an ad-hoc check is most likely to be forgotten.
 *
 * Tenancy is always applied first: no query crosses a company boundary.
 */

export function tenantFilter(user: AuthUser): { companyId: string } {
  return { companyId: user.companyId };
}

/** Restricts assets to what the actor's scope permits. */
export function assetScopeFilter(user: AuthUser): Prisma.AssetWhereInput {
  const base: Prisma.AssetWhereInput = tenantFilter(user);

  switch (user.scope) {
    case 'ALL':
      return base;

    case 'DEPARTMENT':
      // A departmentless user with department scope sees nothing rather than
      // everything - failing open here would be the worst possible default.
      return user.departmentId
        ? { ...base, departmentId: user.departmentId }
        : { ...base, id: { in: [] } };

    case 'DIRECT_REPORTS':
      return {
        ...base,
        OR: [{ assignedUserId: user.id }, { assignedUser: { profile: { managerId: user.id } } }],
      };

    case 'OWN':
    default:
      return { ...base, assignedUserId: user.id };
  }
}

/** Restricts requests to what the actor's scope permits. */
export function requestScopeFilter(user: AuthUser): Prisma.AssetRequestWhereInput {
  const base: Prisma.AssetRequestWhereInput = tenantFilter(user);

  switch (user.scope) {
    case 'ALL':
      return base;

    case 'DEPARTMENT':
      return user.departmentId
        ? { ...base, departmentId: user.departmentId }
        : { ...base, id: { in: [] } };

    case 'DIRECT_REPORTS':
      return {
        ...base,
        OR: [
          { requesterId: user.id },
          { beneficiaryId: user.id },
          { managerId: user.id },
          { requester: { profile: { managerId: user.id } } },
        ],
      };

    case 'OWN':
    default:
      // Includes requests raised on the employee's behalf by HR, which are theirs
      // to track even though they did not create them.
      return { ...base, OR: [{ requesterId: user.id }, { beneficiaryId: user.id }] };
  }
}

/** Restricts user records to what the actor's scope permits. */
export function userScopeFilter(user: AuthUser): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = tenantFilter(user);

  switch (user.scope) {
    case 'ALL':
      return base;
    case 'DEPARTMENT':
      return user.departmentId
        ? { ...base, profile: { departmentId: user.departmentId } }
        : { ...base, id: { in: [] } };
    case 'DIRECT_REPORTS':
      return { ...base, OR: [{ id: user.id }, { profile: { managerId: user.id } }] };
    case 'OWN':
    default:
      return { ...base, id: user.id };
  }
}

/**
 * True when the actor may see monetary fields. Callers strip cost columns rather
 * than omitting the row, so HR can still manage an asset it may not price
 * (spec section 3).
 */
export function canSeeCost(user: AuthUser): boolean {
  return user.permissions.includes('assets:cost:read');
}

/** Removes monetary fields from a payload for actors without cost permission. */
export function redactCost<T extends Record<string, unknown>>(
  user: AuthUser,
  record: T,
  fields: readonly (keyof T)[] = [
    'purchaseCost',
    'currentValue',
    'salvageValue',
    'unitCost',
    'averageCost',
    'estimatedCost',
  ] as readonly (keyof T)[],
): T {
  if (canSeeCost(user)) return record;
  const copy = { ...record };
  for (const field of fields) {
    if (field in copy) delete copy[field];
  }
  return copy;
}
