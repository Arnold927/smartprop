import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type Theme = "light" | "gray" | "dark";

const STORAGE_KEY = "smartprop-theme";

interface DarkModeContextValue {
  isDark: boolean;
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const DarkModeContext = createContext<DarkModeContextValue>({
  isDark: false,
  theme: "light",
  toggle: () => {},
  setTheme: () => {},
});

/**
 * DarkModeProvider
 *
 * Owns theme state directly — does NOT delegate to useDarkMode().
 * Delegating to the hook caused "Cannot read properties of null (reading 'useState')"
 * on hard refresh because client/package.json had "smartprop": "file:.." which
 * installed a second copy of React from root/node_modules. Even with the vite alias
 * the circular local-package dependency created a split React instance.
 *
 * Fix: remove "smartprop": "file:.." from client/package.json AND keep state here.
 * Both fixes are needed — the alias alone is not enough.
 */
export function DarkModeProvider({ children }: { children: ReactNode }) {
  // Start with "light" — never read localStorage at module-eval time.
  // Reading it synchronously here (before React mounts) is safe because
  // we are inside a function body, but we still defer to useEffect so
  // that the first render is consistent with SSR/prerender if ever needed.
  const [theme, setThemeState] = useState<Theme>("light");

  // Hydrate from localStorage once after first mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "light" || stored === "gray" || stored === "dark") {
        setThemeState(stored);
        return;
      }
      // Migrate old boolean flag
      if (localStorage.getItem("smartprop-dark-mode") === "true") {
        setThemeState("dark");
        return;
      }
      // System preference fallback
      if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
        setThemeState("dark");
      }
    } catch {
      // localStorage blocked (private browsing, etc.) — stay on "light"
    }
  }, []);

  // Keep <html> class list and localStorage in sync whenever theme changes
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "gray");
    if (theme === "dark") root.classList.add("dark");
    if (theme === "gray") root.classList.add("gray");
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  // Cycle: light → gray → dark → light
  const toggle = () =>
    setThemeState((prev) => {
      if (prev === "light") return "gray";
      if (prev === "gray") return "dark";
      return "light";
    });

  const setTheme = (t: Theme) => setThemeState(t);
  const isDark = theme === "dark";

  return (
    <DarkModeContext.Provider value={{ isDark, theme, toggle, setTheme }}>
      {children}
    </DarkModeContext.Provider>
  );
}

export function useDarkModeContext() {
  return useContext(DarkModeContext);
}
