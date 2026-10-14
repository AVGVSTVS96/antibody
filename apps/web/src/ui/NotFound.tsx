import { useEffect } from "react";
import { billHref, onLink } from "../lib/router.ts";
import { useIndex } from "../lib/useIndex.ts";
import { Kicker, Wrap } from "./primitives.tsx";
import { SearchBox } from "./Search.tsx";

/** No such bill (`id`), or no such page or part of a bill (`title`). */
export function NotFound({ id, title }: { id?: string; title?: string }) {
  const index = useIndex();
  useEffect(() => {
    document.title = "Not found · antibody";
  }, []);
  return (
    <Wrap className="page notfound">
      <Kicker>NOT FOUND</Kicker>
      <h1>{title ?? (id ? "We have no x-ray for that bill." : "There is no page here.")}</h1>
      <p className="lead">
        {id && (
          <>
            <code>{id}</code> is not in the library.{" "}
          </>
        )}
        Search for a bill we have, or pick one below.
      </p>
      <SearchBox size="hero" placeholder="S.1582, H.R. 1, GENIUS, or a congress.gov link" />
      {index && (
        <ul className="notfound-list">
          {index.bills.map((b) => (
            <li key={b.id}>
              <a className="plain" href={billHref(b.id)} onClick={onLink}>
                <b>{b.display}</b> {b.shortTitle ?? b.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Wrap>
  );
}
