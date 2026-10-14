import { billHref, onLink } from "../lib/router.ts";
import { useIndex } from "../lib/useIndex.ts";
import { Kicker, Wrap } from "../ui/primitives.tsx";
import { SearchBox } from "../ui/Search.tsx";

export default function LandPage() {
  const index = useIndex();
  return (
    <Wrap className="page">
      <Kicker>STEP 1 · FIND A BILL</Kicker>
      <h1 className="hero">
        Read the part the news <span className="hl">skipped.</span>
      </h1>
      <SearchBox size="hero" placeholder="S.1582, H.R. 1, GENIUS, or a congress.gov link" />
      <section id="library">
        <h2>The library{index && `: ${index.bills.length} bills`}</h2>
        <ul>
          {index?.bills.map((b) => (
            <li key={b.id}>
              <a href={billHref(b.id)} onClick={onLink}>
                {b.display} {b.shortTitle ?? b.title}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </Wrap>
  );
}
