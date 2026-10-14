import { useState } from "react";
import { RULES_URL } from "../lib/format.ts";
import { billHref, landHref, libraryHref, onLink, routeHref, useRoute } from "../lib/router.ts";
import { toggleTheme, useTheme } from "../lib/theme.ts";
import { useIndex } from "../lib/useIndex.ts";
import { Moon, Sun } from "./icons.tsx";
import { SearchBox } from "./Search.tsx";

export function Logo() {
  return (
    <a className="logo plain" href={landHref()} onClick={onLink} aria-label="antibody, home">
      anti<span>body</span>
    </a>
  );
}

function ThemeButton() {
  const theme = useTheme();
  return (
    <button
      type="button"
      className="box-btn"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </button>
  );
}

/** The bar every page sits under: logo, the open bill, search, how we score, theme. Rendered once by the shell. */
export function Top() {
  const route = useRoute();
  const index = useIndex();
  const [sheetOn, setSheetOn] = useState<string | null>(null);
  const bill = route.page === "land" || route.page === "missing" ? null : route.id;
  const entry = bill ? index?.bills.find((b) => b.id === bill) : undefined;

  const here = routeHref(route);
  const sheet = sheetOn === here;

  return (
    <header className="top" data-bill={bill ? "" : undefined}>
      <div className="top-bar">
        <Logo />
        {entry && (
          <>
            <span className="slash" aria-hidden="true">
              /
            </span>
            <a className="crumb plain" href={billHref(entry.id)} onClick={onLink}>
              {entry.display}
              <span className="crumb-name"> · {entry.shortTitle ?? entry.title}</span>
            </a>
          </>
        )}
        <nav className="top-nav" aria-label="Site">
          {bill ? (
            <div className="top-search">
              <SearchBox />
            </div>
          ) : (
            <a className="plain" href={libraryHref()} onClick={onLink}>
              THE LIBRARY
            </a>
          )}
          <a className="plain" href={RULES_URL} target="_blank" rel="noopener noreferrer">
            HOW WE SCORE
          </a>
          {!bill && index && (
            <a className="boxed plain" href={libraryHref()} onClick={onLink}>
              {index.bills.length} BILLS X-RAYED
            </a>
          )}
          <ThemeButton />
        </nav>
        {bill && (
          <button
            type="button"
            className="top-find"
            aria-expanded={sheet}
            aria-controls="top-sheet"
            onClick={() => setSheetOn(sheet ? null : here)}
          >
            {entry?.display ?? "FIND"} ▾
          </button>
        )}
      </div>
      {bill && sheet && (
        <div className="top-sheet" id="top-sheet">
          <SearchBox autoFocus onDone={() => setSheetOn(null)} />
          <a className="plain" href={RULES_URL} target="_blank" rel="noopener noreferrer">
            HOW WE SCORE ↗
          </a>
          <ThemeButton />
        </div>
      )}
    </header>
  );
}
