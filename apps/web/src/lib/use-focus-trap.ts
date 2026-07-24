'use client';

import { useEffect, useRef } from 'react';

/**
 * Traps keyboard focus inside a dialog and restores it on close (WCAG 2.4.3).
 *
 * Returns a ref to attach to the dialog container. While `active`, Tab and
 * Shift+Tab cycle within the container's focusable elements, and the element
 * that had focus before the dialog opened is refocused when it closes.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(active = true) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Move focus into the dialog if it isn't already there.
    if (!container.contains(document.activeElement)) {
      focusable()[0]?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const activeEl = document.activeElement;

      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // Restore focus to whatever triggered the dialog.
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
