import { expect, test } from "bun:test";
import { Bundle, billStats, featuredOf } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import { tapeOfFeatured } from "../src/land/featured.ts";
import { lineageOf, storyOf } from "../src/land/rules.ts";
import { buildModel } from "../src/lib/model.ts";
import { buildTape } from "../src/lib/tape.ts";

const bundle = Bundle.parse(genius);
const stats = billStats(bundle);

test("the tape built from the index's featured block is the tape built from the whole bundle", () => {
  const whole = buildTape(buildModel(bundle));
  const light = tapeOfFeatured(featuredOf(bundle, stats.deficitMusd));
  const { view: _, ...mark } = whole.rows[0]!;
  expect(Object.keys(light.rows[0]!).sort()).toEqual(Object.keys(mark).sort());
  expect(light.rows.map(({ label: _l, ...r }) => r)).toEqual(whole.rows.map(({ view: _v, label: _l, ...r }) => r));
  expect({ ...light, rows: [] }).toEqual({ ...whole, rows: [] });
});

test("the exhibit is the quiet and costly section the most filings name, and says when it appeared", () => {
  const featured = featuredOf(bundle, stats.deficitMusd);
  const row = featured.rows[featured.exhibit!.row]!;
  expect(row.kind).toBe("quiet");
  expect(row.num).toBe("19");
  expect(row.named).toBe(bundle.sections.find((s) => s.id === row.id)!.score!.components.lobbyingReports);
  expect(lineageOf(featured)?.text).toMatch(/^First appeared in the “.+” text/);
});

const entry = (s: Partial<typeof stats>) => ({
  ...bundleCard,
  stats: { ...stats, ...s },
});
const bundleCard = {
  id: "x",
  display: "H.R.1",
  title: "An Act",
  shortTitle: null,
  law: null,
  sponsorParty: null,
  congress: 119,
  latestActionOn: null,
  file: "x.json",
  articlesFile: null,
};

test("a bill the quiet test could not run on says so, and never that no section met the rule", () => {
  const story = storyOf(
    entry({
      buried: 0,
      buriedTest: {
        tested: false,
        why: "too few news articles to rank this bill's sections",
        bigStakes: 0,
        dollarsMeasured: true,
      },
    }),
  );
  expect(story.lead).toBe("We couldn't test this bill for quiet sections.");
  expect(story.body).toBe("Too few news articles to rank this bill's sections.");
});

test("a tested bill with no quiet section leads with its own section count, and nothing buried", () => {
  const a = storyOf(entry({ buried: 0, sections: 217 }));
  const b = storyOf(entry({ buried: 0, sections: 20 }));
  expect(a.lead).toBe("217 sections, none quiet and costly.");
  expect(a.lead).not.toBe(b.lead);
  expect(a.body).toStartWith("No section met the quiet-and-costly rule.");
  expect(`${a.lead} ${a.body}`).not.toMatch(/buried|we checked/i);
});
