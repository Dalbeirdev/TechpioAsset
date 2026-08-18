import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

/**
 * Theme preference, stored on the device.
 *
 * The app read the system setting and nothing else, so someone whose phone is
 * dark all day had no way to keep PioAssets light - the web app has had that
 * choice since v2.x. "System" stays the default and remains the behaviour for
 * anyone who never opens this.
 *
 * SecureStore is not the obvious home for a non-secret, but it is the store the
 * app already carries and a theme flag does not justify a second dependency.
 * On web it is unavailable, so the preference simply does not persist there -
 * the dev preview is not where anyone sets their theme.
 */

export type Appearance = 'light' | 'dark' | 'system';

const KEY = 'appearance-preference';

interface AppearanceState {
  preference: Appearance;
  setPreference: (next: Appearance) => void;
  /** False until the stored value has been read, so nothing paints the wrong theme first. */
  ready: boolean;
}

const AppearanceContext = createContext<AppearanceState | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<Appearance>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        if (Platform.OS !== 'web') {
          const stored = await SecureStore.getItemAsync(KEY);
          if (stored === 'light' || stored === 'dark' || stored === 'system') {
            setPreferenceState(stored);
          }
        }
      } catch {
        // A device that cannot read the store still gets the system theme.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setPreference = useCallback((next: Appearance) => {
    setPreferenceState(next);
    if (Platform.OS !== 'web') {
      void SecureStore.setItemAsync(KEY, next).catch(() => undefined);
    }
  }, []);

  const value = useMemo(
    () => ({ preference, setPreference, ready }),
    [preference, setPreference, ready],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

/**
 * Returns 'system' when read outside the provider rather than throwing: the
 * theme is used by every screen, and a missing provider should not be a crash.
 */
export function useAppearance(): AppearanceState {
  return (
    useContext(AppearanceContext) ?? {
      preference: 'system',
      setPreference: () => undefined,
      ready: true,
    }
  );
}
