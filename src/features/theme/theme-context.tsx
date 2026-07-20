import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "midnight" | "sunrise" | "ocean";
const KEY = "mp.theme";

const VALID_THEMES: Theme[] = ["light", "dark", "midnight", "sunrise", "ocean"];

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}
const Ctx = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  defaultTheme = "dark",
}: {
  children: ReactNode;
  defaultTheme?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  // Hydrate from localStorage after mount to avoid SSR mismatches.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY) as Theme | null;
      if (stored && (VALID_THEMES as string[]).includes(stored)) {
        setThemeState(stored);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
  };

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
