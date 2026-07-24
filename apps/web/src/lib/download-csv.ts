import { API_BASE, getAccessToken } from '@/lib/api-client';

/**
 * Downloads an authenticated CSV export. A bare anchor href can't carry the
 * Authorization header, so we fetch to a blob and trigger a synthetic download.
 * Returns false if the request fails, so callers can surface an error toast.
 */
export async function downloadCsv(path: string, filename: string): Promise<boolean> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
  });
  if (!response.ok) return false;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
