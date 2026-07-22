'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Boxes,
  CircleHelp,
  ClipboardList,
  Cpu,
  LayoutDashboard,
  Menu,
  BarChart3,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Search,
  Users,
  Wrench,
  X,
} from 'lucide-react';
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

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/assets', label: 'Assets', Icon: Boxes, permission: PERMISSIONS.ASSETS_READ },
  { href: '/my-assets', label: 'My assets', Icon: Package },
  { href: '/requests', label: 'Requests', Icon: ClipboardList },
  { href: '/invoices', label: 'Invoices', Icon: Receipt, permission: PERMISSIONS.INVOICES_READ },
  { href: '/people', label: 'People', Icon: Users, permission: PERMISSIONS.EMPLOYEES_READ },
  {
    href: '/maintenance',
    label: 'Maintenance',
    Icon: Wrench,
    permission: PERMISSIONS.MAINTENANCE_READ,
  },
  { href: '/reports', label: 'Reports', Icon: BarChart3, permission: PERMISSIONS.REPORTS_READ },
  { href: '/settings/ai', label: 'AI settings', Icon: Cpu, permission: PERMISSIONS.AI_CONFIGURE },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, status, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
  const visible = NAV.filter((item) => !item.permission || can(item.permission));

  const nav = (
    <nav className="grid gap-0.5 p-2" aria-label="Main">
      {visible.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
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
      })}
    </nav>
  );

  return (
    <div className="min-h-screen">
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

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
