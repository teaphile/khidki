import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ResolvedTheme, ThemeMode } from '../types';

const STORAGE_KEY = 'khidki.theme';
const LEGACY_KEY = 'sotto.theme';

export const LIGHT_THEME_COLOR = '#f5f7fb';
export const DARK_THEME_COLOR = '#0b0f17';

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
  return 'system';
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveInitialTheme(): ResolvedTheme {
  const stored = readStoredMode();
  return stored === 'system' ? systemTheme() : stored;
}

export function applyDocumentTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  const themeColor = resolved === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemResolved(query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = mode === 'system' ? systemResolved : mode;

  useEffect(() => {
    applyDocumentTheme(resolved);
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    const nextResolved = next === 'system' ? systemTheme() : next;
    applyDocumentTheme(nextResolved);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference persistence is optional.
    }
  }, []);

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider.');
  return context;
}
