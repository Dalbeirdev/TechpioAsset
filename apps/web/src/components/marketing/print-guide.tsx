'use client';

import { Printer } from 'lucide-react';

/**
 * "Save as PDF" for a guide page (v2.24).
 *
 * The user guide used to be a PDF and was retired because a downloaded file
 * cannot be corrected once it is on somebody's desktop. That reasoning holds -
 * but people still want a copy to hand to a new starter or attach to an
 * induction pack, and printing the live page gives them one that was correct
 * the day it was made rather than last year.
 *
 * The browser's own print dialogue does the work, so there is no second copy of
 * the content to keep in step - which is the whole point.
 */
export function PrintGuide() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print-hidden inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-white/20"
    >
      <Printer aria-hidden="true" className="size-3.5" />
      Save as PDF
    </button>
  );
}
