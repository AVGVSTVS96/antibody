import * as analyze from "@antibody/analyze";
import type { Stage } from "@antibody/core";
import * as bills from "@antibody/ingest-bills";
import * as cbo from "@antibody/ingest-cbo";
import * as fec from "@antibody/ingest-fec";
import * as lobbying from "@antibody/ingest-lobbying";
import * as members from "@antibody/ingest-members";
import * as news from "@antibody/ingest-news";
import * as trades from "@antibody/ingest-trades";
import * as resolve from "@antibody/resolve";
import * as store from "@antibody/store";
import * as watch from "@antibody/watch";

export const PACKAGES: Record<string, Stage[]> = {
  "@antibody/ingest-bills": bills.stages,
  "@antibody/ingest-cbo": cbo.stages,
  "@antibody/ingest-lobbying": lobbying.stages,
  "@antibody/ingest-trades": trades.stages,
  "@antibody/ingest-members": members.stages,
  "@antibody/ingest-fec": fec.stages,
  "@antibody/ingest-news": news.stages,
  "@antibody/resolve": resolve.stages,
  "@antibody/analyze": analyze.stages,
  "@antibody/store": store.stages,
  "@antibody/watch": watch.stages,
};
