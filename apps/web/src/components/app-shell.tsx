'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronRight,
  Boxes,
  CircleHelp,
  ClipboardList,
  Cpu,
  LayoutDashboard,
  LineChart,
  Menu,
  BarChart3,
  Package,
  PanelLeftClose,
  Plug,
  PanelLeftOpen,
  Radar,
  Receipt,
  ShoppingCart,
  ScrollText,
  KeyRound,
  Search,
  ShieldCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { Wallet } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { useAuth } from '@/providers/auth-provider';
import { cn } from '@/lib/cn';
import { ProfileMenu } from './profile-menu';
import { NotificationBell } from './notification-bell';
import { ThemeToggle } from './theme-toggle';

interface NavItem {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
  /** Hidden unless the user holds this. The API enforces it regardless. */
  permission?: string;
}

interface NavGroup {
  /** Stable key — persisted, so renaming the label must not reset anybody. */
  key: string;
  label: string;
  items: NavItem[];
}

/**
 * Always visible, never inside a group: the place people go back to.
 */
const NAV_TOP: NavItem[] = [{ href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard }];

/**
 * The rest of the menu, grouped and COLLAPSED BY DEFAULT.
 *
 * Eighteen flat entries made the sidebar a wall of similar-looking words, and
 * the ones people use daily sat next to ones they open twice a year. Grouping
 * them puts the whole map on one screen; collapsing them by default means the
 * common case is short.
 *
 * Two behaviours make that survivable rather than annoying, and both matter:
 * the group holding the current page opens itself, so you can always see where
 * you are; and whatever you open by hand is remembered, so somebody who lives
 * in Procurement is not re-opening it every morning.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    key: 'workspace',
    label: 'My workspace',
    items: [
      { href: '/my-assets', label: 'My assets', Icon: Package },
      { href: '/requests', label: 'Requests', Icon: ClipboardList },
    ],
  },
  {
    key: 'assets',
    label: 'Assets',
    items: [
      { href: '/assets', label: 'Assets', Icon: Boxes, permission: PERMISSIONS.ASSETS_READ },
      { href: '/licenses', label: 'Licenses', Icon: KeyRound, permission: PERMISSIONS.LICENSES_READ },
      {
        href: '/maintenance',
        label: 'Maintenance',
        Icon: Wrench,
        permission: PERMISSIONS.MAINTENANCE_READ,
      },
      { href: '/discovery', label: 'Discovery', Icon: Radar, permission: PERMISSIONS.DISCOVERY_READ },
    ],
  },
  {
    key: 'buying',
    label: 'Buying & stock',
    items: [
      {
        href: '/procurement',
        label: 'Procurement',
        Icon: ShoppingCart,
        permission: PERMISSIONS.PROCUREMENT_PR_READ,
      },
      { href: '/inventory', label: 'Inventory', Icon: Boxes, permission: PERMISSIONS.INVENTORY_READ },
      // v2.9 C2: a budget is a money figure, so it follows the cost-read rule.
      { href: '/budgets', label: 'Budgets', Icon: Wallet, permission: PERMISSIONS.ASSETS_COST_READ },
      { href: '/invoices', label: 'Invoices', Icon: Receipt, permission: PERMISSIONS.INVOICES_READ },
    ],
  },
  {
    key: 'insights',
    label: 'Insights',
    items: [
      { href: '/analytics', label: 'Analytics', Icon: LineChart, permission: PERMISSIONS.ANALYTICS_READ },
      { href: '/reports', label: 'Reports', Icon: BarChart3, permission: PERMISSIONS.REPORTS_READ },
      { href: '/audit', label: 'Audit log', Icon: ScrollText, permission: PERMISSIONS.AUDIT_READ },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    items: [
      { href: '/people', label: 'People', Icon: Users, permission: PERMISSIONS.EMPLOYEES_READ },
      { href: '/settings/roles', label: 'Roles', Icon: ShieldCheck, permission: PERMISSIONS.ROLES_MANAGE },
      {
        href: '/settings/integrations',
        label: 'Integrations',
        Icon: Plug,
        permission: PERMISSIONS.INTEGRATIONS_MANAGE,
      },
      { href: '/settings/ai', label: 'AI settings', Icon: Cpu, permission: PERMISSIONS.AI_CONFIGURE },
    ],
  },
];

const OPEN_GROUPS_KEY = 'techpioasset:nav:open-groups';

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, status, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Empty on first render on purpose: it matches the server's HTML, and it is
  // the "default hide" the menu is meant to start from. What the user has
  // opened before is restored after mount, below.
  const [openGroups, setOpenGroups] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPEN_GROUPS_KEY);
      if (stored) setOpenGroups(JSON.parse(stored) as string[]);
    } catch {
      // A corrupt or unavailable localStorage is not worth breaking a menu over.
    }
  }, []);

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // Persisting is a nicety; the menu still works without it.
      }
      return next;
    });
  };

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  // Navigating on mobile should dismiss the drawer, otherwise it covers the page
  // the user just asked for.
  useEffect(() => setDrawerOpen(false), [pathname]);

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="text-sm text-[var(--color-content-subtle)]">Loading…</p>
      </div>
    );
  }
  if (!user) return null;

  // Menu visibility is a convenience, never the control: every route below is
  // independently enforced by the API (spec section 20).
  // Menu visibility is a convenience, never the control: every route below is
  // independently enforced by the API (spec section 20).
  const allowed = (items: NavItem[]) => items.filter((i) => !i.permission || can(i.permission));

  // A group with nothing the user may see is not a group with an empty drawer —
  // it simply is not there.
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: allowed(g.items) })).filter(
    (g) => g.items.length > 0,
  );

  const link = ({ href, label, Icon }: NavItem) => {
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? label : undefined}
        className={cn(
          'flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors',
          active
            ? 'bg-[var(--color-surface-sunken)] font-medium'
            : 'text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
        )}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className={cn(collapsed && 'lg:sr-only')}>{label}</span>
      </Link>
    );
  };

  // Icon-only rail: there is no room for a heading, and a collapsed group inside
  // a collapsed sidebar would hide everything behind two clicks. Show the icons.
  const railNav = (
    <nav className="grid gap-0.5 p-2" aria-label="Main">
      {[...allowed(NAV_TOP), ...groups.flatMap((g) => g.items)].map(link)}
    </nav>
  );

  const groupedNav = (
    <nav className="grid gap-0.5 p-2" aria-label="Main">
      {allowed(NAV_TOP).map(link)}

      {groups.map((group) => {
        // The section holding the current page opens itself. Without this, one
        // click through the menu would close the menu around you and there
        // would be nothing on screen saying where you are.
        const holdsCurrentPage = group.items.some((i) => isActive(pathname, i.href));
        const open = openGroups.includes(group.key) || holdsCurrentPage;
        const panelId = `nav-group-${group.key}`;
        return (
          <div key={group.key} className="mt-1">
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              aria-expanded={open}
              aria-controls={panelId}
              className={cn(
                'flex w-full items-center gap-2 rounded-[var(--radius-control)] px-3 py-2',
                'text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors',
                'text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)]',
              )}
            >
              <ChevronRight
                aria-hidden="true"
                className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
              />
              <span className="flex-1 text-left">{group.label}</span>
              {/* A closed section still says how much is inside it. */}
              {!open ? <span className="tabular-nums">{group.items.length}</span> : null}
            </button>

            {open ? (
              <div id={panelId} className="grid gap-0.5">
                {group.items.map(link)}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );

  const nav = collapsed ? railNav : groupedNav;

  return (
    <div className="min-h-screen">
      {/* Bypass blocks (WCAG 2.4.1): the first Tab lands here so a keyboard user
          can jump past the header and nav straight to the page content. Visually
          hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-[var(--color-brand)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--color-brand-contrast)]"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 lg:px-4">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setDrawerOpen(true)}
          className="grid size-9 place-items-center rounded-[var(--radius-control)] hover:bg-[var(--color-surface-sunken)] lg:hidden"
        >
          <Menu aria-hidden="true" className="size-5" />
        </button>

        <Link href="/dashboard" className="font-semibold tracking-tight">
          TechpioAsset
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--color-content-subtle)]"
            />
            <input
              type="search"
              aria-label="Search assets"
              placeholder="Search…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const value = (e.target as HTMLInputElement).value.trim();
                  if (value) router.push(`/assets?q=${encodeURIComponent(value)}`);
                }
              }}
              className="h-9 w-44 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] pl-8 text-sm md:w-60"
            />
          </div>
          <NotificationBell />
          <ThemeToggle />
          <Link
            href="/help"
            aria-label="Help"
            className="grid size-9 place-items-center rounded-[var(--radius-control)] hover:bg-[var(--color-surface-sunken)]"
          >
            <CircleHelp aria-hidden="true" className="size-5" />
          </Link>
          <ProfileMenu />
        </div>
      </header>

      <div className="flex">
        <aside
          className={cn(
            'sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r border-[var(--color-border)] lg:block',
            collapsed ? 'w-16' : 'w-60',
          )}
        >
          {nav}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="mx-2 mt-1 flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)]"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            )}
            <span className={cn(collapsed && 'sr-only')}>Collapse</span>
          </button>
        </aside>

        {drawerOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setDrawerOpen(false)}
              className="absolute inset-0 bg-black/40"
            />
            <div className="relative h-full w-64 border-r border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="flex h-14 items-center justify-between px-3">
                <span className="font-semibold">Menu</span>
                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={() => setDrawerOpen(false)}
                  className="grid size-9 place-items-center rounded-[var(--radius-control)] hover:bg-[var(--color-surface-sunken)]"
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              </div>
              {nav}
            </div>
          </div>
        ) : null}

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 lg:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
