import { toggleTheme, useTheme } from "../lib/theme.ts";
import { Contrast } from "./icons.tsx";

export function ThemeButton() {
  const theme = useTheme();
  return (
    <button
      type="button"
      className="iconbtn"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      <Contrast />
    </button>
  );
}
