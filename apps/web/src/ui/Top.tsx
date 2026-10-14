import type { ReactNode } from "react";
import { onLink } from "../lib/router.ts";
import { Mark } from "./icons.tsx";
import { ThemeButton } from "./ThemeButton.tsx";

export function Top({ crumb, right, theme = true }: { crumb?: ReactNode; right?: ReactNode; theme?: boolean }) {
  return (
    <header className="top">
      <a className="brand" href="/" onClick={onLink}>
        <Mark />
        <b>antibody</b>
        {crumb && (
          <>
            <span className="slash">/</span>
            <span className="crumb">{crumb}</span>
          </>
        )}
        {right && <span className="cap">{right}</span>}
      </a>
      {theme && <ThemeButton />}
    </header>
  );
}
