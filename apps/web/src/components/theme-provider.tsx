'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Theme flips are instant; animating them causes a visible colour smear on
      // every surface at once.
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
