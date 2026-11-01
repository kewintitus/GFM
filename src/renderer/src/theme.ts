export type ThemeName = "light" | "dark";

const THEME_KEY = "gfm-theme";

export function readTheme(): ThemeName {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" ? "light" : "dark";
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}
