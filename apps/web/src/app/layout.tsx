import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { QueryProvider } from '@/providers/query-provider';
import { buildToneCss } from '@/lib/tone-css';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'TechpioAsset',
    template: '%s · TechpioAsset',
  },
  description: 'Manage Assets. Control Costs. Simplify Operations.',
  applicationName: 'TechpioAsset',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1120' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Status tone palette, generated from @techpioasset/ui-tokens. */}
        <style dangerouslySetInnerHTML={{ __html: buildToneCss() }} />
      </head>
      {/* Browser extensions (ColorZilla, Grammarly, etc.) inject attributes onto
          <body> before React hydrates; suppressHydrationWarning on <html> only
          covers one level, so <body> needs its own to silence that false mismatch. */}
      <body suppressHydrationWarning>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-[var(--color-brand)] focus:px-3 focus:py-2 focus:text-[var(--color-brand-contrast)]"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              <div id="main">{children}</div>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
