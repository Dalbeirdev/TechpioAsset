/**
 * v2.27 - what a scanned QR code actually contains.
 *
 * The label printed from the web does not encode the bare token. It encodes the
 * address the token lives at:
 *
 *     https://pioassets.com/assets/scan/01KYX56HZT81QXS171WT4H9XGG
 *
 * The scanner was passing whatever the camera read straight to
 * `/assets/by-qr/:token`, which matches the token column exactly - so every
 * label printed from the web resolved to "that code does not match an asset you
 * can access". The code was right, the label was right, and the two were never
 * introduced.
 *
 * This lives outside the screen because it is the part worth proving without a
 * camera: a URL, a bare token, and the things a real scanner picks up off a
 * grubby label all have to come out the same.
 */

/** The path the web label points at; the token is the segment after it. */
const SCAN_PATH = /\/assets\/scan\/([^/?#]+)/i;

/**
 * The token to look up from whatever the camera read.
 *
 * Only the label address is special-cased. Anything else is handed to the API
 * as-is and allowed to be a miss: a first draft tried to classify foreign QR
 * codes and reject them early, which sorted a wifi join and a mailto link into
 * opposite buckets for no reason a user could follow. The API already answers
 * "no such asset" for a code that is not ours, and the screen already says so.
 *
 * Null only for an empty scan, so a blank read never becomes a lookup that
 * comes back not-found and reads as a missing device.
 */
export function qrTokenFrom(scanned: string): string | null {
  const trimmed = scanned.trim();
  if (!trimmed) return null;

  // Matched by pattern rather than by parsing a URL, because the host varies by
  // deployment: a label printed against staging, or against localhost during
  // setup, still has to scan against production.
  const inPath = SCAN_PATH.exec(trimmed);
  if (inPath?.[1]) return decodeURIComponent(inPath[1]);

  // A bare token - what the API takes, and what a hand-made label carries.
  return trimmed;
}
