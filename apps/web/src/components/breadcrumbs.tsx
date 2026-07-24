import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumb trail for nested pages. The last crumb is the current page (no link). */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-[var(--color-content-muted)]">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="hover:text-[var(--color-content)] hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={last ? 'font-medium text-[var(--color-content)]' : undefined}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!last ? (
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 text-[var(--color-content-subtle)]"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
