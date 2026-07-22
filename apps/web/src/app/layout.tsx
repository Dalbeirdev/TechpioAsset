import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
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
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
