import { useMemo } from "react";
import { Exhibit } from "../land/Exhibit.tsx";
import { FeaturedStats, FeaturedTape } from "../land/FeaturedTape.tsx";
import { Also, JustIn, Lede, RulesNote } from "../land/Front.tsx";
import { type Featured, useFeatured, usePhone } from "../land/hooks.ts";
import { Library } from "../land/Library.tsx";
import { type IndexBill, libraryOf } from "../land/rules.ts";
import { buildTape } from "../lib/tape.ts";
import { useIndex } from "../lib/useIndex.ts";
import { MiniTape } from "../ui/MiniTape.tsx";
import { Kicker, Section, Wrap } from "../ui/primitives.tsx";
import { ReceiptProvider } from "../ui/receipt.tsx";
import { SearchBox } from "../ui/Search.tsx";
import "../land/land.css";

const resultTape = (b: IndexBill) =>
  b.stats && (
    <span className="sr-tape">
      <MiniTape fingerprint={b.stats.fingerprint} height={24} label={b.shortTitle ?? b.title} />
    </span>
  );

function Sourced({ featured, children }: { featured: Featured; children: React.ReactNode }) {
  return featured.model ? <ReceiptProvider bundle={featured.model.b}>{children}</ReceiptProvider> : children;
}

export default function LandPage() {
  const index = useIndex();
  const phone = usePhone();
  const bills = useMemo(() => (index ? libraryOf(index) : []), [index]);
  const bill = bills[0];
  const featured = useFeatured(bill?.id);
  const tape = useMemo(() => featured.model && buildTape(featured.model), [featured.model]);

  return (
    <div className="land">
      <Wrap className="land-hero">
        <div className="land-copy">
          <Kicker>STEP 1 · FIND A BILL</Kicker>
          <h1 className="hero">
            Read the part
            <br />
            the news <span className="hl">skipped.</span>
          </h1>
          <p className="lead">
            Every US federal bill, one section at a time: what the headlines fought over, what rode along quietly, what
            CBO says it costs, and who lobbied, funded and traded around it.
            {!phone && " Every line links its public record."}
          </p>
          <SearchBox size="hero" placeholder="S.1582, H.R. 1, GENIUS, or a congress.gov link" renderBill={resultTape} />
        </div>
        {bill && !phone && (
          <div className="land-slot">
            <Sourced featured={featured}>
              <Exhibit bill={bill} model={featured.model} phone={false} />
            </Sourced>
          </div>
        )}
      </Wrap>
      {bill && (
        <>
          {phone && <Lede bill={bill} />}
          <Section className="land-feature">
            <Sourced featured={featured}>
              <FeaturedTape bill={bill} tape={tape} phone={phone} />
              {featured.failed && (
                <p className="land-note">The full tape did not load. Every bill still opens from the library below.</p>
              )}
              {phone && (
                <div className="land-slot">
                  <Exhibit bill={bill} model={featured.model} phone />
                </div>
              )}
              <FeaturedStats bill={bill} model={featured.model} tape={tape} />
            </Sourced>
          </Section>
          {phone && <Also bills={bills.slice(1, 3)} />}
        </>
      )}
      {bills.length > 0 ? (
        <Library bills={bills} phone={phone} />
      ) : (
        <Section id="library" title="The library" className="land-lib">
          <div className="bone land-bone-lib" role="status" aria-label="Loading the library" />
        </Section>
      )}
      {phone && index && (
        <Wrap className="land-tail">
          <JustIn picks={index.watch.slice(0, 5)} />
          <RulesNote />
        </Wrap>
      )}
    </div>
  );
}
