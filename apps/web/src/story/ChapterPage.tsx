import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from "react";
import { onLink, storyHref } from "../lib/router.ts";
import { useModel } from "../ui/BillGate.tsx";
import { Kicker } from "../ui/primitives.tsx";
import type { HeadLine } from "./data.ts";
import { readSeconds } from "./read.ts";
import { TITLES } from "./titles.ts";

interface StoryState {
  n: number;
  setRead: (seconds: number) => void;
}

export const StoryContext = createContext<StoryState>({ n: 1, setRead() {} });

export interface Cta {
  title: string;
  hint: string;
  href: string;
}

export interface ChapterProps {
  head: HeadLine[];
  lede: string;
  /** More prose the chapter shows, so the reading time counts it. */
  prose?: (string | undefined)[];
  kicker?: ReactNode;
  chips?: ReactNode;
  tone?: "quiet";
  inference?: boolean;
  notes?: ReactNode;
  cta?: Cta | null;
  ledger?: { label: string; tag: string; href: string };
  share?: boolean;
  children?: ReactNode;
}

function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h16M13 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

function ShareButton({ href }: { href: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(href, location.origin).href);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2400);
  };
  return (
    <button type="button" className="share" onClick={copy}>
      <b>Share this story</b>
      <span aria-live="polite">
        {state === "copied" ? "LINK COPIED" : state === "failed" ? "COPY FAILED, USE THE ADDRESS BAR" : "COPY LINK ↗"}
      </span>
    </button>
  );
}

export function ChapterPage({
  head,
  lede,
  prose = [],
  kicker,
  chips,
  tone,
  inference,
  notes,
  cta,
  ledger,
  share,
  children,
}: ChapterProps) {
  const { n, setRead } = useContext(StoryContext);
  const id = useModel().b.bill.id;
  const next = TITLES[n];
  const text = [head.map((l) => l.text).join(" "), lede, ...prose.filter((s): s is string => !!s)];
  const seconds = readSeconds(text);
  useLayoutEffect(() => setRead(seconds), [seconds, setRead]);
  const to =
    cta === undefined
      ? next
        ? { title: next.card, hint: `CHAPTER ${n + 1} OF 6`, href: storyHref(id, n + 1) }
        : null
      : cta;

  return (
    <article
      className="ch"
      data-ch={n}
      data-tone={tone}
      data-inference={inference || undefined}
      aria-label={TITLES[n - 1]?.title}
    >
      <header className="ch-head">
        {kicker && <Kicker>{kicker}</Kicker>}
        <h1 className="ch-h1" tabIndex={-1}>
          {head.map((l) => (
            <span key={l.text} className="ch-line" data-tone={l.tone}>
              {l.text}
            </span>
          ))}
        </h1>
      </header>
      <div className="ch-lede">
        <p className="lead">{lede}</p>
        {chips && <div className="chips">{chips}</div>}
      </div>
      <div className="ch-body">{children}</div>
      {notes && <aside className="ch-notes">{notes}</aside>}
      <footer className="ch-foot">
        {to && (
          <a className="cta" href={to.href} onClick={onLink}>
            <b>{to.title}</b>
            <span>{to.hint}</span>
            <Arrow />
          </a>
        )}
        {ledger && (
          <a className="ledger" href={ledger.href} onClick={onLink}>
            <b>{ledger.label}</b>
            <span>{ledger.tag} ↗</span>
          </a>
        )}
        {share && <ShareButton href={storyHref(id)} />}
      </footer>
    </article>
  );
}

export const useStory = () => useContext(StoryContext);
