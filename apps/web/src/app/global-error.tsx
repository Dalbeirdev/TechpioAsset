'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary: catches errors thrown in the root layout itself, where
 * the app's providers and design tokens are unavailable. It replaces the whole
 * document, so it renders its own <html>/<body> with self-contained styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: '#f7f8fa',
          color: '#171b22',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center', padding: '1.5rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            The application ran into a problem
          </h1>
          <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#4a5261' }}>
            Please reload the page. If it keeps happening, contact your administrator.
          </p>
          {error.digest ? (
            <p
              style={{
                marginTop: '0.5rem',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.75rem',
                color: '#7b8494',
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.25rem',
              height: '2.5rem',
              padding: '0 1rem',
              borderRadius: '8px',
              border: 'none',
              background: '#4338ca',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
