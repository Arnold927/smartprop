import { useState, useEffect } from "react";

export type Theme = "light" | "gray" | "dark";

const STORAGE_KEY = "smartprop-theme";

/**
 * useDarkMode — standalone hook for components that need theme access
 * outside the DarkModeProvider tree (rare).
 *
 * For normal use, prefer useDarkModeContext() from DarkModeContext.tsx —
 * that reads from the shared provider and does not create a separate state.
 *
 * IMPORTANT: This hook must only be called inside a React component or
 * another hook. Never call it at module-evaluation time.
 */
export function useDarkMode() {
  const [theme, setThemeState] = useState<Theme>(() => {
    // Lazy initializer — runs once inside React, never at module load.
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "light" || stored === "gray" || stored === "dark") return stored;
      if (localStorage.getItem("smartprop-dark-mode") === "true") return "dark";
      return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "gray");
    if (theme === "dark") root.classList.add("dark");
    if (theme === "gray") root.classList.add("gray");
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme]);

  const toggle = () =>
    setThemeState((prev) => {
      if (prev === "light") return "gray";
      if (prev === "gray") return "dark";
      return "light";
    });

  const setTheme = (t: Theme) => setThemeState(t);
  const isDark = theme === "dark";

  return { theme, isDark, toggle, setTheme };
}
