import { apiFetchPage } from './api-client';

/**
 * Everyone who could be picked as a person (v2.26) — a line manager, or someone
 * to cover your approvals.
 *
 * Both pickers first asked for `pageSize=200`, which the API rejects outright:
 * every collection is capped at MAX_PAGE_SIZE (100) so a caller cannot turn a
 * paginated endpoint into a full table scan. The rejection was a 422, the query
 * failed, and the select rendered with nothing in it but its placeholder - a
 * picker that looks fine and simply offers no one.
 *
 * So it pages, at the cap. The ceiling is generous rather than unlimited for the
 * same reason the API has one: a picker listing thousands of names is the wrong
 * control anyway, and it should stop rather than hammer the endpoint.
 */

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export interface Colleague {
  id: string;
  email: string;
  profile: { firstName: string; lastName: string } | null;
}

/** "Priya Sharma" where a profile exists, the email where it does not. */
export function colleagueName(c: Colleague): string {
  const name = c.profile ? `${c.profile.firstName} ${c.profile.lastName}`.trim() : '';
  return name || c.email;
}

export async function fetchColleagues(): Promise<Colleague[]> {
  const all: Colleague[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await apiFetchPage<Colleague>(
      `/users?page=${page}&pageSize=${PAGE_SIZE}&view=active&sort=name&order=asc`,
    );
    all.push(...res.data);
    if (page >= res.meta.page.totalPages) break;
  }
  return all;
}
