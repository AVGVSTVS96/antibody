import type { ArticleList } from "@antibody/core";
import { loadIndex } from "../lib/data.ts";

const lists = new Map<string, Promise<ArticleList | null>>();

/** Every counted article of one bill, fetched on first ask: it is only needed where the full list is shown. */
export function loadArticles(id: string): Promise<ArticleList | null> {
  let p = lists.get(id);
  if (!p) {
    p = loadIndex().then(async (index) => {
      const file = index.bills.find((b) => b.id === id)?.articlesFile;
      if (!file) return null;
      const r = await fetch(`/bundles/${file}`);
      if (!r.ok) throw new Error(`${r.status} ${file}`);
      return (await r.json()) as ArticleList;
    });
    p.catch(() => lists.delete(id));
    lists.set(id, p);
  }
  return p;
}
