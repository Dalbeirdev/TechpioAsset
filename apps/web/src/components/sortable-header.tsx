'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

/**
 * A table heading you can click to sort by (v2.27).
 *
 * Lifted out of the People page when the asset list needed the same thing.
 * Copying it would have been quicker and would have left two of them to drift:
 * the accessible `aria-sort` state and the screen-reader hint are the parts
 * most likely to be dropped in a copy, and they are the parts a keyboard or
 * screen-reader user depends on to know the table is sortable at all.
 *
 * Generic over the field type so each table keeps its own union of sortable
 * columns and cannot ask for one the API will not honour.
 */
export function SortableHeader<F extends string>({
  label,
  field,
  sort,
  order,
  onSort,
  align = 'left',
}: {
  label: string;
  field: F;
  sort: F | null;
  order: 'asc' | 'desc';
  onSort: (field: F) => void;
  /** Right-aligned for numeric columns, so the heading sits over its figures. */
  align?: 'left' | 'right';
}) {
  const active = sort === field;
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 font-medium ${align === 'right' ? 'text-right' : ''}`}
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-[var(--color-brand)] ${
          align === 'right' ? 'flex-row-reverse' : ''
        }`}
      >
        {label}
        {active ? (
          order === 'asc' ? (
            <ArrowUp aria-hidden="true" className="size-3.5" />
          ) : (
            <ArrowDown aria-hidden="true" className="size-3.5" />
          )
        ) : (
          // Visible but recessive: the control has to look sortable before it
          // is used, or nobody discovers it is one.
          <ArrowUpDown aria-hidden="true" className="size-3.5 opacity-40" />
        )}
        <span className="sr-only">
          {active ? `, sorted ${order === 'asc' ? 'ascending' : 'descending'}` : ', click to sort'}
        </span>
      </button>
    </th>
  );
}
