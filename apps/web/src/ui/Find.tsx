import { billDisplay, congressGovUrl, parseBillId } from "@antibody/core";
import type { BillId, BundleIndex } from "@antibody/core";
import { useCallback, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useIndex } from "../lib/data.ts";
import { billHref, navigate, onLink } from "../lib/router.ts";
import { Search } from "./icons.tsx";

type Entry = BundleIndex["bills"][number];

const squash = (s: string) => s.toLowerCase().replaceAll(/[\s.]/gu, "");

export const matchBills = (bills: Entry[], q: string) => {
  const needle = q.trim().toLowerCase();

  if (!needle) {
    return [];
  }

  return bills.filter((b) =>
    [b.id, b.display, b.title, b.shortTitle ?? "", b.law ?? ""].some(
      (s) => s.toLowerCase().includes(needle) || squash(s).includes(squash(needle)),
    ),
  );
};

export function asBillId(raw: string): BillId | null {
  try {
    return parseBillId(raw.trim());
  } catch {
    return null;
  }
}

export function NotXrayed({ id }: { id: BillId }) {
  return (
    <>
      {billDisplay(id)} ({id.split("-")[0]}th Congress) isn’t x-rayed yet.{" "}
      <a href={congressGovUrl(id)} target="_blank" rel="noopener">
        Read it on congress.gov
      </a>
      .
    </>
  );
}

export function Find() {
  const index = useIndex();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const [phone, setPhone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useId();

  const root = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      return;
    }

    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest("input,textarea,[contenteditable]") !== null;

      if (e.key !== "/" || e.metaKey || e.ctrlKey || typing) {
        return;
      }

      e.preventDefault();
      setPhone(true);
      input.current?.focus();
    };

    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && el.contains(e.target))) {
        setOpen(false);
        setPhone(false);
      }
    };

    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown);

    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("pointerdown", onDown);
    };
  }, []);

  const hits = index ? matchBills(index.bills, q).slice(0, 6) : [];
  const unknown = q.trim() && !hits.length ? asBillId(q) : null;

  const go = (id: string) => {
    setOpen(false);
    setPhone(false);
    setQ("");
    input.current?.blur();
    navigate(billHref(id));
  };

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const hit = hits[at] ?? hits[0];

    if (hit) {
      go(hit.id);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAt((a) => Math.max(0, Math.min(hits.length - 1, a + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Escape") {
      setOpen(false);
      setPhone(false);
      input.current?.blur();
    }
  };

  return (
    <div className={`find${phone ? " on" : ""}`} ref={root}>
      <button
        type="button"
        className="iconbtn find-open plain"
        aria-label="Find a bill"
        onClick={() => {
          setPhone(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
      >
        <Search />
      </button>
      <search className="find-box">
        <Search />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setAt(0);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submit(e);
            } else {
              onKey(e);
            }
          }}
          placeholder="Find a bill by number or name"
          aria-label="Find a bill by number or name"
          aria-controls={list}
          aria-expanded={open && !!q.trim()}
          role="combobox"
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>/</kbd>
      </search>
      {open && q.trim() && (
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a combobox's popup of links: <select> and <datalist> can't hold links or be styled
        <div className="find-menu" id={list} role="listbox">
          {hits.map((b, i) => (
            <a
              key={b.id}
              href={billHref(b.id)}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- each option is a real link, which an <option> can't be
              role="option"
              aria-selected={i === at}
              onClick={(e) => {
                onLink(e);
                go(b.id);
              }}
              onPointerEnter={() => {
                setAt(i);
              }}
            >
              <b>{b.shortTitle ?? b.title}</b>
              <span>
                {b.display}
                {(b.law ?? "") === "" ? "" : `, ${b.law}`}
              </span>
            </a>
          ))}
          {!hits.length && (
            <div className="find-none">
              {unknown === null ? (
                <>No bill matches “{q.trim()}”. Try a number like S.1582 or H.R. 1.</>
              ) : (
                <NotXrayed id={unknown} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
