/**
 * The issue list an employee picks from when something is wrong with their
 * equipment (v2.14).
 *
 * Why a catalogue at all: "describe your problem" produces a hundred spellings
 * of the same fault, which is unreportable and slow to triage. A fixed list
 * gives IT a queue they can sort, and gives the business a number - "keyboard
 * failures on this model, this quarter" - that free text can never yield.
 *
 * Each entry decides two things the employee should not have to think about:
 * which request TYPE the ticket becomes (so it routes through the existing
 * approval workflow) and how urgent it starts. Everything else about the
 * request pipeline - approvals, comments, attachments, notifications - is
 * unchanged; this is a front door, not a second system.
 */
export const ISSUE_CATEGORIES = [
  {
    key: 'PERFORMANCE',
    label: 'Laptop performance issue',
    hint: 'Slow, freezing, overheating or crashing',
    requestType: 'REPAIR',
    priority: 'NORMAL',
    icon: 'Gauge',
  },
  {
    key: 'DISPLAY',
    label: 'Display issue',
    hint: 'Flickering, cracked screen, external monitor not working',
    requestType: 'REPAIR',
    priority: 'NORMAL',
    icon: 'Monitor',
  },
  {
    key: 'INPUT_DEVICE',
    label: 'Keyboard / mouse issue',
    hint: 'Keys not responding, trackpad or mouse faults',
    requestType: 'REPAIR',
    priority: 'NORMAL',
    icon: 'Keyboard',
  },
  {
    key: 'AUDIO_VIDEO',
    label: 'Headset / camera issue',
    hint: 'Microphone, speakers or webcam not working on calls',
    requestType: 'REPAIR',
    priority: 'NORMAL',
    icon: 'Headphones',
  },
  {
    key: 'SOFTWARE',
    label: 'Software issue',
    hint: 'An application will not install, launch or sign in',
    requestType: 'REPAIR',
    priority: 'NORMAL',
    icon: 'AppWindow',
  },
  {
    key: 'HARDWARE_DAMAGE',
    label: 'Hardware damage',
    hint: 'Dropped, liquid damage, broken port or hinge',
    // Damage has its own request type because it carries different questions
    // (what happened, is it still usable) and often a different approval path.
    requestType: 'DAMAGE',
    priority: 'HIGH',
    icon: 'ShieldAlert',
  },
  {
    key: 'REPLACEMENT',
    label: 'Replacement request',
    hint: 'The device is beyond repair or past its life',
    requestType: 'REPLACEMENT',
    priority: 'NORMAL',
    icon: 'RefreshCw',
  },
  {
    key: 'OTHER',
    label: 'Other asset issue',
    hint: 'Anything else about equipment issued to you',
    requestType: 'REPAIR',
    priority: 'NORMAL',
    icon: 'CircleHelp',
  },
] as const;

export type IssueCategoryKey = (typeof ISSUE_CATEGORIES)[number]['key'];

export const ISSUE_CATEGORY_KEYS = ISSUE_CATEGORIES.map((c) => c.key) as readonly IssueCategoryKey[];

/** The catalogue entry for a key, or undefined if it is not one we publish. */
export function findIssueCategory(key: string | null | undefined) {
  if (!key) return undefined;
  return ISSUE_CATEGORIES.find((c) => c.key === key);
}
