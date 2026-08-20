import { readFile } from 'node:fs/promises';

/**
 * The build this server is running (v2.25).
 *
 * The sidebar, and everything else in the app shell, is loaded once when a tab
 * first opens; Next then navigates between pages without fetching it again. So
 * a tab left open across a deploy keeps the old shell indefinitely - through
 * navigation, and through signing out and back in. That is how a menu item
 * shipped days earlier can be invisible to somebody still on yesterday's
 * bundle, with nothing on screen to suggest anything is wrong.
 *
 * Next writes a fresh BUILD_ID on every build, so the file is a free version
 * stamp: no build argument to pass, nothing for a deploy to remember. The
 * client does not need to know its own build - it only needs to notice that
 * this value has changed since its page loaded.
 */

export const dynamic = 'force-dynamic';

let cached: string | null = null;

export async function GET() {
  // The file cannot change under a running server - a new build means a new
  // container - so it is read once and held.
  if (cached === null) {
    cached = (await readFile('.next/BUILD_ID', 'utf8').catch(() => 'development')).trim();
  }

  return Response.json(
    { build: cached },
    // Never cached: a stale answer here is precisely the problem this exists to
    // detect, and the response is a few bytes.
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
