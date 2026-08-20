import { AppShell } from '@/components/app-shell';
import { VersionWatcher } from '@/components/version-watcher';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      {children}
      {/* Mounted in the layout rather than a page: the shell is the thing that
          goes stale across a deploy, so the watcher has to live at the same
          level as the shell to be there when it does. */}
      <VersionWatcher />
    </AppShell>
  );
}
