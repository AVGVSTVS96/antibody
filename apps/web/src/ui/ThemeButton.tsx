import { toggleTheme, useTheme } from "../lib/theme.ts";
import { Moon, Sun } from "./icons.tsx";

export function ThemeButton({ className = "iconbtn" }: { className?: string }) {
  const theme = useTheme();
  return (
    <button
      type="button"
      className={className}
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </button>
  );
}
