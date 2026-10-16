import type { ReactNode } from "react";
import { navigate, onLink } from "../lib/router.ts";
import { Find } from "./Find.tsx";
import { Mark } from "./icons.tsx";
import { ThemeButton } from "./ThemeButton.tsx";

export function Top({ crumb, find = false }: { crumb?: ReactNode; find?: boolean }) {
  return (
    <header className="nav">
      <div className="wrap nav-in">
        <div className="nav-l">
          <a className="brand" href="/" onClick={onLink}>
            <Mark />
            antibody
          </a>
          {crumb && (
            <div className="crumb">
              <span aria-hidden="true">/</span>
              <span>{crumb}</span>
            </div>
          )}
        </div>
        <div className="nav-r">
          {find && <Find />}
          <button type="button" className="navlink" onClick={() => navigate("/#read")}>
            How we read bills
          </button>
          <ThemeButton />
        </div>
      </div>
    </header>
  );
}

export function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="foot">
      <div className="wrap">{children}</div>
    </footer>
  );
}
