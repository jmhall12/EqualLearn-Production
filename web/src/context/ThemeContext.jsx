import { createContext, useContext, useEffect, useMemo } from 'react';

const themes = [{ id: 'ptc', label: 'EqualLearn Dark' }];
const ThemeContext = createContext(null);
const DARK_THEME = 'ptc';

export function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.dataset.theme = DARK_THEME;
    document.documentElement.style.colorScheme = 'dark';
    if (document.body) {
      document.body.dataset.theme = 'dark';
      document.body.style.colorScheme = 'dark';
    }
    try { localStorage.setItem('equallearn-theme', DARK_THEME); } catch (_) {}
  }, []);

  const value = useMemo(() => ({ theme: DARK_THEME, setTheme: () => {}, themes }), []);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }
