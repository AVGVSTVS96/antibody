import { useCallback, useEffect, useRef, useState } from "react";
import { type BillRoute, billHref, landHref, onLink, STORY_CHAPTERS, storyHref } from "../lib/router.ts";
import { StoryContext } from "../story/ChapterPage.tsx";
import { CHAPTERS } from "../story/chapters.ts";
import { clock } from "../story/read.ts";
import { TITLES } from "../story/titles.ts";
import { useChapterNav } from "../story/useChapterNav.ts";
import { useModel } from "../ui/BillGate.tsx";
import "../story/story.css";

export default function StoryPage({ route }: { route: Extract<BillRoute, { page: "story" }> }) {
  const m = useModel();
  const { bill } = m.b;
  const n = route.chapter ?? 1;
  const [seconds, setRead] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const shown = useRef(n);
  useChapterNav(stage, bill.id, n);

  useEffect(() => {
    if (shown.current === n) return;
    shown.current = n;
    stage.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [n]);

  const read = useCallback((s: number) => setRead(s), []);
  const Chapter = CHAPTERS[n - 1]!;
  const title = TITLES[n - 1]!.title.toUpperCase();

  return (
    <StoryContext value={{ n, setRead: read }}>
      <div className="story" ref={stage}>
        <header className="story-head">
          <div className="story-bar">
            <a className="story-mark plain" href={landHref()} onClick={onLink} aria-label="antibody, home">
              ✱
            </a>
            <span className="story-bill">
              {bill.display} · {bill.shortTitle ?? bill.title}
            </span>
            <span className="story-count">
              CHAPTER {n} OF {STORY_CHAPTERS} · {title}
              <time dateTime={`PT${seconds}S`}>
                {clock(seconds)}
                <span className="sr"> to read</span>
              </time>
            </span>
            <a
              className="story-close"
              href={billHref(bill.id)}
              onClick={onLink}
              aria-label="Close the story and open the x-ray"
            >
              ×
            </a>
          </div>
          <nav className="story-steps" aria-label="Chapters">
            <ol>
              {TITLES.map((t, i) => (
                <li key={t.title} data-state={i + 1 < n ? "done" : i + 1 === n ? "now" : "next"}>
                  <a href={storyHref(bill.id, i + 1)} onClick={onLink} aria-current={i + 1 === n ? "step" : undefined}>
                    <span className="sr">
                      Chapter {i + 1}: {t.title}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </header>
        <Chapter m={m} />
      </div>
    </StoryContext>
  );
}
